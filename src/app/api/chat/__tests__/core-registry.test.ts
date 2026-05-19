/**
 * coreRegistry composition tests.
 *
 * The chat route depends on coreRegistry to know which entities the AI can
 * search and how to fetch their summaries. These assertions pin the registry's
 * shape so a future core addition (or accidental removal) can't silently
 * change the chat surface.
 */

import { describe, it, expect, vi } from "vitest";

// Mirrors entity-configs.test.ts: a few cores transitively touch the Supabase
// browser client (enum-value/core.ts → @/lib/supabase/client). Stubbing it at
// import time keeps the registry importable in the Vitest environment.
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({ select: () => ({ data: [], error: null }) }),
  }),
}));

import { coreRegistry } from "@/entities/cores";

const EXPECTED_KEYS = [
  "allocation", "batch", "beer_style", "bin", "brand", "brew_log",
  "container", "customer", "delivery", "enum_value", "finished_good",
  "inventory_item", "inventory_lot", "keg_inventory", "keg_owner",
  "keg_transaction", "location", "location_transfer", "order", "order_item",
  "packaging_session", "pick_list", "po_line_item", "po_receive",
  "pricing_tier", "pricing_tier_price", "purchase_order", "recipe",
  "sales_channel", "selling_format", "session_line_item", "supplier",
  "user_profile", "vessel", "vessel_transfer", "water_profile",
  "yeast_pitch", "yeast_pitch_event", "yeast_strain",
] as const;

describe("coreRegistry", () => {
  it("contains exactly 39 entries", () => {
    expect(coreRegistry.size).toBe(39);
  });

  it("contains every expected entity key", () => {
    const actual = Array.from(coreRegistry.keys()).sort();
    expect(actual).toEqual([...EXPECTED_KEYS].sort());
  });

  it("contains the 3 entities entity-map.ts forgot", () => {
    expect(coreRegistry.has("container")).toBe(true);
    expect(coreRegistry.has("selling_format")).toBe(true);
    expect(coreRegistry.has("yeast_pitch_event")).toBe(true);
  });

  it("does NOT contain the 2 reference-table map-only entries", () => {
    // package_types / keg_types have no entity config and are no longer
    // chat-searchable. The AI can still surface keg type names via getKegInventory.
    expect(coreRegistry.has("package_type")).toBe(false);
    expect(coreRegistry.has("keg_type")).toBe(false);
  });

  it("every entry carries the fields the chat read path consumes", () => {
    for (const [key, entity] of coreRegistry) {
      expect(entity.name, `${key}: missing name`).toBe(key);
      expect(entity.table, `${key}: missing table`).toBeTruthy();
      expect(entity.displayName, `${key}: missing displayName`).toBeTruthy();
      expect(entity.displayNamePlural, `${key}: missing displayNamePlural`).toBeTruthy();
    }
  });

  it("the 8 explicitly-sorted cores expose their defaultSort", () => {
    const nameSorted = ["brand", "keg_owner", "sales_channel", "water_profile", "yeast_strain"] as const;
    for (const key of nameSorted) {
      expect(coreRegistry.get(key)?.defaultSort).toEqual({ column: "name", direction: "asc" });
    }
    const createdAtSorted = ["order_item", "po_line_item", "session_line_item"] as const;
    for (const key of createdAtSorted) {
      expect(coreRegistry.get(key)?.defaultSort).toEqual({ column: "created_at", direction: "desc" });
    }
  });
});
