/**
 * CHAT_ENTITY_MAP ↔ Entity Registry Sync Test
 *
 * The chat API route cannot import the real entity registry (entity configs
 * import React client components), so src/app/api/chat/entity-map.ts
 * hand-duplicates a server-safe subset of each entity's metadata. This test
 * prevents the two from drifting apart:
 *
 * - every chat-map key is explicitly mapped to a registry entity (or
 *   explicitly declared registry-less),
 * - table / viewTable agree with the registry,
 * - the chat map's searchableFields are a subset of the registry's,
 * - the column the chat map sorts by actually exists on the relation the
 *   entity service will query (parsed from the generated Supabase types),
 * - keyFields and detailHeader field names exist as columns on that same
 *   queried relation (viewTable ?? table).
 *
 * If this test fails after editing an entity config, update
 * src/app/api/chat/entity-map.ts (and the mapping below) to match.
 */

import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Mock the Supabase client to avoid env var requirements during import.
// Several entity configs transitively import components that call createClient()
// at module scope (e.g., revision-history.tsx).
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ data: [], error: null }),
    }),
  }),
}));

import { entityRegistry } from "@/types/entity";

// Importing the registry module triggers registration of all entities.
import "@/entities/index";

import { CHAT_ENTITY_MAP } from "../entity-map";

// =============================================================================
// Explicit chat-map key → registry name mapping
// =============================================================================

/**
 * Maps every CHAT_ENTITY_MAP key to its entity-registry counterpart.
 * `null` means the chat entry is intentionally registry-less (the table is a
 * plain reference table with no EntityConfig). When adding an entry to
 * CHAT_ENTITY_MAP, add it here too — the test fails otherwise.
 */
const CHAT_KEY_TO_REGISTRY_NAME: Record<string, string | null> = {
  batch: "batch",
  recipe: "recipe",
  brew_log: "brew_log",
  vessel: "vessel",
  vessel_transfer: "vessel_transfer",
  order: "order",
  customer: "customer",
  supplier: "supplier",
  purchase_order: "purchase_order",
  packaging_session: "packaging_session",
  allocation: "allocation",
  delivery: "delivery",
  location_transfer: "location_transfer",
  finished_good: "finished_good",
  pick_list: "pick_list",
  yeast_pitch: "yeast_pitch",
  yeast_strain: "yeast_strain",
  brand: "brand",
  keg_inventory: "keg_inventory",
  keg_transaction: "keg_transaction",
  inventory_item: "inventory_item",
  inventory_lot: "inventory_lot",
  bin: "bin",
  location: "location",
  beer_style: "beer_style",
  // Reference tables exposed to chat but not registered as entities:
  package_type: null,
  keg_type: null,
  keg_owner: "keg_owner",
  order_item: "order_item",
  session_line_item: "session_line_item",
  po_line_item: "po_line_item",
  po_receive: "po_receive",
  sales_channel: "sales_channel",
  pricing_tier: "pricing_tier",
  pricing_tier_price: "pricing_tier_price",
  water_profile: "water_profile",
  user_profile: "user_profile",
  enum_value: "enum_value",
};

/** Chat-map entries that have a registry counterpart, resolved. */
const pairedEntries = Array.from(CHAT_ENTITY_MAP.entries())
  .map(([key, chatEntity]) => {
    const registryName = CHAT_KEY_TO_REGISTRY_NAME[key];
    return {
      key,
      chatEntity,
      registryEntity: registryName ? entityRegistry.get(registryName) : undefined,
    };
  })
  .filter((e) => e.registryEntity !== undefined);

// =============================================================================
// Schema column parsing (generated Supabase types)
// =============================================================================

/**
 * Parses src/types/supabase.ts and returns relation name → set of Row column
 * names, covering both Tables and Views. Used to verify that the columns the
 * chat map sorts/searches on actually exist on the queried relation.
 */
function parseSchemaColumns(): Map<string, Set<string>> {
  const schemaPath = path.resolve(process.cwd(), "src/types/supabase.ts");
  const src = fs.readFileSync(schemaPath, "utf8");
  const relations = new Map<string, Set<string>>();

  // Matches `      relation_name: {\n        Row: { ...columns... }`
  const relationRe = /\n {6}(\w+): \{\n {8}Row: \{([\s\S]*?)\n {8}\}/g;
  let match: RegExpExecArray | null;
  while ((match = relationRe.exec(src)) !== null) {
    const cols = new Set<string>();
    for (const line of match[2].split("\n")) {
      const colMatch = line.match(/^ {10}(\w+)\??:/);
      if (colMatch) cols.add(colMatch[1]);
    }
    relations.set(match[1], cols);
  }
  return relations;
}

const schemaColumns = parseSchemaColumns();

// =============================================================================
// Tests
// =============================================================================

describe("CHAT_ENTITY_MAP ↔ registry sync", () => {
  it("sanity: registry and schema parsing produced data", () => {
    expect(entityRegistry.size).toBeGreaterThan(0);
    expect(CHAT_ENTITY_MAP.size).toBeGreaterThan(0);
    // Guard against a supabase-gen format change silently breaking the regex
    // parser: known tables AND a known view must have parsed with their
    // well-known columns, not just `size > 0`.
    for (const relation of ["batches", "orders", "inventory_lots", "batches_with_brew_info"]) {
      expect(schemaColumns.has(relation), `relation '${relation}' did not parse from src/types/supabase.ts`).toBe(true);
      expect(schemaColumns.get(relation)!.has("id"), `relation '${relation}' parsed without an 'id' column`).toBe(true);
    }
    expect(schemaColumns.get("batches")!.has("batch_code")).toBe(true);
    expect(schemaColumns.get("orders")!.has("order_number")).toBe(true);
  });

  it("every chat-map key has an explicit registry mapping (and vice versa)", () => {
    const chatKeys = Array.from(CHAT_ENTITY_MAP.keys()).sort();
    const mappedKeys = Object.keys(CHAT_KEY_TO_REGISTRY_NAME).sort();
    expect(chatKeys).toEqual(mappedKeys);
  });

  it("every mapped registry name resolves to a registered entity", () => {
    const missing = Object.entries(CHAT_KEY_TO_REGISTRY_NAME)
      .filter(([, registryName]) => registryName !== null)
      .filter(([, registryName]) => !entityRegistry.has(registryName!))
      .map(([key, registryName]) => `${key} -> ${registryName}`);
    expect(missing, `Mapped registry entities not found: ${missing.join(", ")}`).toEqual([]);
  });

  it("chat-map entry name matches its map key", () => {
    for (const [key, chatEntity] of CHAT_ENTITY_MAP.entries()) {
      expect(chatEntity.name, `key '${key}' has mismatched name`).toBe(key);
    }
  });

  it("table matches the registry's table", () => {
    const violations: string[] = [];
    for (const { key, chatEntity, registryEntity } of pairedEntries) {
      if (chatEntity.table !== registryEntity!.table) {
        violations.push(
          `${key}: chat table '${chatEntity.table}' != registry table '${registryEntity!.table}'`
        );
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("viewTable matches the registry's viewTable when both define it", () => {
    const violations: string[] = [];
    for (const { key, chatEntity, registryEntity } of pairedEntries) {
      if (!chatEntity.viewTable || !registryEntity!.viewTable) continue;
      if (chatEntity.viewTable !== registryEntity!.viewTable) {
        violations.push(
          `${key}: chat viewTable '${chatEntity.viewTable}' != registry viewTable '${registryEntity!.viewTable}'`
        );
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("chat searchableFields are a subset of the registry's searchableFields", () => {
    const violations: string[] = [];
    for (const { key, chatEntity, registryEntity } of pairedEntries) {
      if (!chatEntity.searchableFields?.length) continue;
      const registryFields = new Set(
        (registryEntity!.searchableFields ?? []).map(String)
      );
      for (const field of chatEntity.searchableFields) {
        if (!registryFields.has(String(field))) {
          violations.push(
            `${key}: chat searchable field '${String(field)}' is not in registry searchableFields [${[...registryFields].join(", ")}]`
          );
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  // The two schema-existence tests below are scoped to entries with a registry
  // counterpart: the registry-less reference tables (keg_type, package_type)
  // are environment-dependent (see migration 00155's IF EXISTS guard) and may
  // be absent from the generated types.
  it("the queried relation (viewTable ?? table) exists in the generated schema", () => {
    const violations: string[] = [];
    for (const { key, chatEntity } of pairedEntries) {
      const relation = chatEntity.viewTable ?? chatEntity.table;
      if (!schemaColumns.has(relation)) {
        violations.push(`${key}: relation '${relation}' not found in src/types/supabase.ts`);
      }
      if (chatEntity.viewTable && !schemaColumns.has(chatEntity.table)) {
        violations.push(`${key}: base table '${chatEntity.table}' not found in src/types/supabase.ts`);
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("defaultSort column exists on the queried relation", () => {
    const violations: string[] = [];
    for (const { key, chatEntity } of pairedEntries) {
      if (!chatEntity.defaultSort) continue;
      const relation = chatEntity.viewTable ?? chatEntity.table;
      const cols = schemaColumns.get(relation);
      if (!cols) continue; // covered by the relation-existence test above
      const column = String(chatEntity.defaultSort.column);
      if (!cols.has(column)) {
        violations.push(`${key}: defaultSort column '${column}' does not exist on '${relation}'`);
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  // The chat route reads detailHeader/keyFields off raw records fetched from
  // (viewTable ?? table), so a misnamed field silently yields `undefined` in
  // the AI context summary instead of erroring (the yeast_strain keyFields bug
  // class). Verify each named field is a real column on the queried relation.
  it("keyFields columns exist on the queried relation", () => {
    const violations: string[] = [];
    for (const { key, chatEntity } of pairedEntries) {
      if (!chatEntity.keyFields?.length) continue;
      const relation = chatEntity.viewTable ?? chatEntity.table;
      const cols = schemaColumns.get(relation);
      if (!cols) continue; // covered by the relation-existence test above
      for (const field of chatEntity.keyFields) {
        if (!cols.has(String(field))) {
          violations.push(`${key}: keyFields column '${String(field)}' does not exist on '${relation}'`);
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("detailHeader fields (title/subtitle/badge) exist on the queried relation", () => {
    const violations: string[] = [];
    for (const { key, chatEntity } of pairedEntries) {
      if (!chatEntity.detailHeader) continue;
      const relation = chatEntity.viewTable ?? chatEntity.table;
      const cols = schemaColumns.get(relation);
      if (!cols) continue; // covered by the relation-existence test above
      for (const [part, field] of Object.entries(chatEntity.detailHeader)) {
        if (field !== undefined && !cols.has(String(field))) {
          violations.push(`${key}: detailHeader.${part} '${String(field)}' does not exist on '${relation}'`);
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });
});
