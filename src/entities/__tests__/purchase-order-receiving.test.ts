/**
 * Purchase Order receiving-flow wiring tests
 *
 * Guards the contracts that make the PO receive chain reachable end-to-end
 * (line-item entry → Receive Items → accept into inventory → landed cost):
 *
 * - the line_items relation renders the inline POLineItemsEditor (custom
 *   relation component) instead of the generic RelationTable whose Add link
 *   404s (po_line_item has no create route)
 * - the "receive_items" action is an interception action (no toState — the
 *   POReceiving dialog derives partial vs fulfilled from received totals)
 *   and is only offered from states whose transitions permit the flip;
 *   notably NOT from "submitted", where POReceiving's own state-machine
 *   validation would throw
 * - the bare mark_partial/fulfill transition buttons stay removed (they
 *   flipped status without capturing quantities, lots, or dates)
 * - po_receive remains a registered, deliberately slim entity (rows are
 *   created by POReceiving; it has no routes or detail/edit sections)
 */

import { describe, it, expect, beforeAll, vi } from "vitest";

// Mock the Supabase client to avoid env var requirements during import.
// Entity configs transitively import components that call createClient()
// at module scope.
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ data: [], error: null }),
    }),
  }),
}));

import { entityRegistry } from "@/types/entity";
import "@/entities/index";

beforeAll(() => {
  expect(entityRegistry.size).toBeGreaterThan(0);
});

describe("purchase_order receiving wiring", () => {
  it("line_items relation uses the inline editor component (no RelationTable 404 Add link)", () => {
    const po = entityRegistry.get("purchase_order");
    const lineItems = po?.relations?.find((r) => r.name === "line_items");
    expect(lineItems).toBeDefined();
    expect(lineItems!.component).toBeDefined();
  });

  it("receive_items is an interception action offered only from confirmed/partial", () => {
    const po = entityRegistry.get("purchase_order");
    const receive = po?.actions?.find((a) => a.name === "receive_items");
    expect(receive).toBeDefined();
    // No fixed toState: POReceiving computes partial vs fulfilled from totals.
    expect(receive!.toState).toBeUndefined();
    expect(receive!.fromStates).toEqual(["confirmed", "partial"]);
    // submitted → partial/fulfilled is not a legal transition; offering the
    // action there would make POReceiving's transition validation throw.
    expect(receive!.fromStates).not.toContain("submitted");
  });

  it("every receive_items fromState can legally transition to partial or fulfilled", () => {
    const po = entityRegistry.get("purchase_order");
    const receive = po?.actions?.find((a) => a.name === "receive_items");
    const transitions = po?.stateMachine?.transitions ?? {};
    for (const from of receive?.fromStates ?? []) {
      const targets = transitions[from] ?? [];
      const canFlip =
        targets.includes("partial") ||
        targets.includes("fulfilled") ||
        // POReceiving no-ops when already in the computed target state
        from === "partial";
      expect(canFlip, `receive_items offered from "${from}" but neither partial nor fulfilled is reachable`).toBe(true);
    }
  });

  it("bare mark_partial/fulfill transition buttons stay removed", () => {
    const po = entityRegistry.get("purchase_order");
    const names = po?.actions?.map((a) => a.name) ?? [];
    expect(names).not.toContain("mark_partial");
    expect(names).not.toContain("fulfill");
  });

  it("po_receive stays registered but slim (no routes, no detail/edit sections)", () => {
    const poReceive = entityRegistry.get("po_receive");
    expect(poReceive).toBeDefined();
    expect(poReceive!.basePath).toBeNull();
    expect(poReceive!.sections).toBeUndefined();
    expect(poReceive!.detailHeader).toBeUndefined();
  });
});
