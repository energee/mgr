/**
 * Guards that inventory items, inventory lots, and PO line items all use the
 * single shared unit list (INVENTORY_UNIT_OPTIONS) for their `unit` field.
 *
 * Historically each entity had its own divergent copy (lots were missing
 * "case", PO lines were free text), which let units drift apart across the
 * purchasing → inventory flow. Referential identity with the shared list
 * prevents that class of regression.
 */

import { describe, it, expect, vi } from "vitest";
import type { EntityConfig } from "@/types/entity";

// Mock the Supabase client to avoid env var requirements during import
// (same pattern as entity-configs.test.ts).
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ data: [], error: null }),
    }),
  }),
}));

import { INVENTORY_UNIT_OPTIONS } from "@/domain/inventory-units";
import { inventoryItemEntity } from "@/entities/inventory-item";
import { inventoryLotEntity } from "@/entities/inventory-lot";
import { poLineItemEntity } from "@/entities/po-line-item";

/** Find the `unit` field across an entity's unified sections. */
function findUnitField(config: EntityConfig<Record<string, unknown>>) {
  for (const section of config.sections ?? []) {
    const field = section.fields?.find((f) => f.name === "unit");
    if (field) return field;
  }
  return undefined;
}

describe("shared unit options", () => {
  const cases = [
    ["inventory_item", inventoryItemEntity],
    ["inventory_lot", inventoryLotEntity],
    ["po_line_item", poLineItemEntity],
  ] as const;

  it.each(cases)("%s unit field is a select using the shared list", (name, entity) => {
    const field = findUnitField(
      entity as unknown as EntityConfig<Record<string, unknown>>,
    );
    expect(field, `${name}: no 'unit' field found in sections`).toBeDefined();
    expect(field?.type).toBe("select");
    // Referential identity: editing one copy must edit all of them.
    expect(field?.options).toBe(INVENTORY_UNIT_OPTIONS);
  });
});
