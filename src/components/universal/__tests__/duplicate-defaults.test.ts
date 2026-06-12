/**
 * Framework Duplicate action tests (audit finding 10):
 * - buildDuplicateDefaults carries over editable section-field values and
 *   strips framework baseline fields (id/audit/version), the state-machine
 *   state field, the entity's excludeOnDuplicate identity fields, and
 *   anything that doesn't render an input in create mode
 * - real opted-in configs (purchase_order, inventory_lot, ...) produce sane
 *   prefill payloads
 * - every excludeOnDuplicate entry across the registry names a real section
 *   field, so typo'd exclusions can't silently carry identity fields over
 */

import { describe, it, expect, vi } from "vitest";

// Prevents env-var validation in @/lib/env from throwing at import time
// (revision-history.tsx calls createClient() at module scope).
vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => ({
    from: () => ({ select: () => ({ data: [], error: null }) }),
  })),
}));

// Prevents @sentry/nextjs initialisation errors in jsdom
vi.mock("@/lib/client-logger", () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { buildDuplicateDefaults } from "@/components/universal/entity-detail-unified";
import { entityRegistry, type EntityConfig } from "@/types/entity";
import { purchaseOrderEntity } from "@/entities/purchase-order";
import { inventoryLotEntity } from "@/entities/inventory-lot";
import "@/entities/index";

// ---------------------------------------------------------------------------
// buildDuplicateDefaults — synthetic config
// ---------------------------------------------------------------------------

type FakeRecord = Record<string, unknown>;

const fakeEntity = {
  name: "fake",
  table: "fakes",
  displayName: "Fake",
  displayNamePlural: "Fakes",
  description: "test entity",
  domain: "inventory",
  listColumns: [],
  formSchema: {} as EntityConfig<FakeRecord>["formSchema"],
  stateMachine: {
    stateField: "status",
    states: ["draft", "done"],
    initialState: "draft",
    transitions: { draft: ["done"], done: [] },
  },
  excludeOnDuplicate: ["serial_number"],
  sections: [
    {
      id: "main",
      title: "Main",
      fields: [
        { name: "name", label: "Name", type: "text" as const },
        { name: "serial_number", label: "Serial", type: "text" as const },
        { name: "status", label: "Status", type: "select" as const, editable: false as const },
        { name: "qty", label: "Qty", type: "number" as const },
        { name: "computed_total", label: "Total", editable: false as const, type: "number" as const },
        { name: "display_only", label: "Display" }, // no type → never an input
        { name: "setup_field", label: "Setup", type: "text" as const, editable: "create-only" as const },
        { name: "empty_field", label: "Empty", type: "text" as const },
      ],
    },
  ],
} satisfies EntityConfig<FakeRecord>;

const fakeRecord: FakeRecord = {
  id: "abc-123",
  name: "Widget",
  serial_number: "SN-001",
  status: "done",
  qty: 5,
  computed_total: 99,
  display_only: "view column",
  setup_field: "initial",
  empty_field: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  created_by: "user-1",
  updated_by: "user-2",
  version: 7,
};

describe("buildDuplicateDefaults", () => {
  const result = buildDuplicateDefaults(fakeEntity, fakeRecord);

  it("carries over plain editable field values", () => {
    expect(result.name).toBe("Widget");
    expect(result.qty).toBe(5);
  });

  it("includes create-only fields (editable in create mode)", () => {
    expect(result.setup_field).toBe("initial");
  });

  it("strips framework baseline fields", () => {
    for (const key of [
      "id",
      "created_at",
      "updated_at",
      "created_by",
      "updated_by",
      "version",
    ]) {
      expect(result, `${key} must not carry over`).not.toHaveProperty(key);
    }
  });

  it("strips the state-machine state field", () => {
    expect(result).not.toHaveProperty("status");
  });

  it("strips the entity's excludeOnDuplicate identity fields", () => {
    expect(result).not.toHaveProperty("serial_number");
  });

  it("strips fields that don't render inputs in create mode", () => {
    expect(result).not.toHaveProperty("display_only"); // no type
    expect(result).not.toHaveProperty("computed_total"); // editable: false
  });

  it("drops null values so per-field defaultValues still apply", () => {
    expect(result).not.toHaveProperty("empty_field");
  });

  it("excludes the state field even with an empty excludeOnDuplicate list", () => {
    const noExtra = { ...fakeEntity, excludeOnDuplicate: [] };
    const r = buildDuplicateDefaults(noExtra, fakeRecord);
    expect(r).not.toHaveProperty("status");
    expect(r.name).toBe("Widget");
  });
});

// ---------------------------------------------------------------------------
// buildDuplicateDefaults — real opted-in configs
// ---------------------------------------------------------------------------

describe("buildDuplicateDefaults with real entity configs", () => {
  it("purchase_order copies supplier/costs/notes but not identity or dates", () => {
    const po: Record<string, unknown> = {
      id: "po-1",
      po_number: "PO-2026-001",
      status: "fulfilled",
      supplier_id: "sup-1",
      order_date: "2026-05-01",
      expected_date: "2026-05-10",
      submitted_at: "2026-05-01T10:00:00Z",
      shipping_cost: 45,
      tax: 12.5,
      notes: "deliver to dock 2",
      version: 3,
    };
    const prefill = buildDuplicateDefaults(purchaseOrderEntity, po);
    expect(prefill).toEqual({
      supplier_id: "sup-1",
      shipping_cost: 45,
      tax: 12.5,
      notes: "deliver to dock 2",
    });
  });

  it("inventory_lot copies item/unit/costs but not lot identity or receipt link", () => {
    const lot: Record<string, unknown> = {
      id: "lot-1",
      inventory_item_id: "item-1",
      lot_number: "LOT-2026-001",
      location: "Grain Room A",
      po_receive_id: "rcv-1",
      quantity: 100,
      remaining_quantity: 40,
      allocated_quantity: 10,
      unit: "lb",
      unit_cost: 1.2,
      landed_cost: 1.35,
      received_date: "2026-05-01",
      expiration_date: "2026-12-01",
      notes: null,
    };
    const prefill = buildDuplicateDefaults(inventoryLotEntity, lot);
    expect(prefill).toEqual({
      inventory_item_id: "item-1",
      location: "Grain Room A",
      quantity: 100,
      unit: "lb",
      unit_cost: 1.2,
      landed_cost: 1.35,
      expiration_date: "2026-12-01",
    });
  });
});

// ---------------------------------------------------------------------------
// Registry-wide invariant: exclusions must name real section fields
// ---------------------------------------------------------------------------

describe("excludeOnDuplicate config validity", () => {
  it("registers at least the entities opted in by audit finding 10", () => {
    const optedIn = Array.from(entityRegistry.values())
      .filter((e) => e.excludeOnDuplicate !== undefined)
      .map((e) => e.name);
    for (const name of [
      "purchase_order",
      "inventory_item",
      "customer",
      "supplier",
      "vessel",
      "inventory_lot",
    ]) {
      expect(optedIn, `${name} should opt in to Duplicate`).toContain(name);
    }
  });

  it("every excludeOnDuplicate entry names a real section field", () => {
    for (const entity of Array.from(entityRegistry.values())) {
      if (!entity.excludeOnDuplicate?.length) continue;
      const fieldNames = new Set(
        (entity.sections ?? []).flatMap((s) => (s.fields ?? []).map((f) => f.name))
      );
      for (const excluded of entity.excludeOnDuplicate) {
        expect(
          fieldNames.has(excluded),
          `${entity.name}: excludeOnDuplicate entry "${excluded}" is not a section field — ` +
            `only section fields carry over, so this exclusion would do nothing (typo?)`
        ).toBe(true);
      }
    }
  });
});
