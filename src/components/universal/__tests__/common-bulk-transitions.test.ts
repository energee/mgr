/**
 * commonBulkTransitions — the intersection of transitions valid for EVERY
 * selected row (ponytail audit item 23).
 *
 * This ran as two hand-copied loops: one in entity-data-table (gating whether
 * the bulk bar renders at all) and one in bulk-status-action-bar (building the
 * options). They agreed, but nothing kept them agreeing — and a drift shows up
 * as a bar that appears and then says "no common status transitions", or one
 * that hides options the selection really has. These tests pin the contract
 * now that both call the one helper.
 */

import { describe, it, expect } from "vitest";
import type { EntityConfig } from "@/types/entity";
import { commonBulkTransitions } from "../bulk-status-action-bar";

type Row = { id: string; status?: string };

/** draft → confirmed|cancelled, confirmed → shipped|cancelled, shipped → (none) */
const entity = {
  name: "orders",
  displayName: "Order",
  displayNamePlural: "Orders",
  stateMachine: {
    stateField: "status",
    transitions: {
      draft: ["confirmed", "cancelled"],
      confirmed: ["shipped", "cancelled"],
      shipped: [],
    },
  },
} as unknown as EntityConfig<Row>;

const noStateMachine = {
  name: "brands",
  displayName: "Brand",
  displayNamePlural: "Brands",
} as unknown as EntityConfig<Row>;

describe("commonBulkTransitions", () => {
  it("returns every target of a uniform selection", () => {
    expect(
      commonBulkTransitions(entity, [
        { id: "a", status: "draft" },
        { id: "b", status: "draft" },
      ]),
    ).toEqual(["confirmed", "cancelled"]);
  });

  it("intersects across mixed states, keeping only shared targets", () => {
    expect(
      commonBulkTransitions(entity, [
        { id: "a", status: "draft" },
        { id: "b", status: "confirmed" },
      ]),
    ).toEqual(["cancelled"]);
  });

  it("returns empty when one selected row is in a terminal state", () => {
    expect(
      commonBulkTransitions(entity, [
        { id: "a", status: "draft" },
        { id: "b", status: "shipped" },
      ]),
    ).toEqual([]);
  });

  it("returns empty for an unknown state rather than an unvalidated target", () => {
    expect(
      commonBulkTransitions(entity, [
        { id: "a", status: "draft" },
        { id: "b", status: "not_a_state" },
      ]),
    ).toEqual([]);
  });

  it("returns empty when a selected row is missing the state field", () => {
    expect(
      commonBulkTransitions(entity, [
        { id: "a", status: "draft" },
        { id: "b" },
      ]),
    ).toEqual([]);
  });

  it("returns empty for an empty selection", () => {
    expect(commonBulkTransitions(entity, [])).toEqual([]);
  });

  it("returns empty for an entity with no state machine", () => {
    expect(
      commonBulkTransitions(noStateMachine, [{ id: "a", status: "draft" }]),
    ).toEqual([]);
  });

  it("dedupes repeated states without shrinking the intersection", () => {
    const many: Row[] = Array.from({ length: 50 }, (_, i) => ({
      id: String(i),
      status: "draft",
    }));
    expect(commonBulkTransitions(entity, many)).toEqual([
      "confirmed",
      "cancelled",
    ]);
  });
});
