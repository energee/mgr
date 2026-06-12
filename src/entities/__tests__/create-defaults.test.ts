/**
 * Create-form known-value defaults (audit finding 05)
 *
 * Required date fields on the order, purchase order, and packaging session
 * create forms must default to today instead of "" — every one of these
 * records is dated "today" ~95% of the time, so the user should not have to
 * open a date picker on each create.
 *
 * The framework invokes field defaultValue functions SYNCHRONOUSLY in
 * buildDefaultValues (entity-detail-unified.tsx), so each default must be a
 * sync `() => string` returning a YYYY-MM-DD date string — these tests pin
 * both the presence and that contract.
 */

import { describe, it, expect, vi } from "vitest";
import type { EntityConfig, UnifiedFieldDef } from "@/types/entity";

// Mock the Supabase client to avoid env var requirements during import.
// Entity configs transitively import components that call createClient()
// at module scope (e.g., revision-history.tsx).
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ data: [], error: null }),
    }),
  }),
}));

import { orderEntity } from "@/entities/order";
import { purchaseOrderEntity } from "@/entities/purchase-order";
import { packagingSessionEntity } from "@/entities/packaging-session";

type AnyEntity = EntityConfig<Record<string, unknown>>;
type AnyField = UnifiedFieldDef<Record<string, unknown>>;

function findField(entity: AnyEntity, name: string): AnyField {
  for (const section of entity.sections ?? []) {
    const field = section.fields?.find((f) => f.name === name);
    if (field) return field;
  }
  throw new Error(`Field ${name} not found on ${entity.name}`);
}

/** Same expression the defaults use — local "today" in YYYY-MM-DD (UTC). */
function todayIso(): string {
  return new Date().toISOString().split("T")[0];
}

const cases: Array<{ entity: AnyEntity; fieldName: string }> = [
  { entity: orderEntity as unknown as AnyEntity, fieldName: "order_date" },
  { entity: purchaseOrderEntity as unknown as AnyEntity, fieldName: "order_date" },
  { entity: packagingSessionEntity as unknown as AnyEntity, fieldName: "session_date" },
];

describe("create-form date defaults", () => {
  it.each(cases.map((c) => [c.entity.name, c] as const))(
    "%s defaults its named date field to today via a sync function",
    (_name, { entity, fieldName }) => {
      const field = findField(entity, fieldName);

      // Must be a function (re-evaluated per mount, not frozen at module
      // load) and synchronous — buildDefaultValues does not await.
      expect(typeof field.defaultValue).toBe("function");
      const value = (field.defaultValue as () => unknown)();
      expect(typeof value).toBe("string");
      expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(value).toBe(todayIso());
    },
  );
});
