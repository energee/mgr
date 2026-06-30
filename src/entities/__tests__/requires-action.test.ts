/**
 * stateMachine.requiresAction Validation Tests
 *
 * `requiresAction` maps a transition target state to the entity action that
 * must be used to reach it (suppressing the generic "Move to {state}" item
 * and the bulk-bar option — see src/types/entity.ts). These tests validate
 * the mapping's integrity for every registered entity so a suppressed
 * generic path can never strand a transition:
 *
 * - the target is a real state and actually reachable via transitions
 * - the named action exists, targets the same state, and is available
 *   (fromStates) from every state the transition is reachable from
 */

import { describe, it, expect, beforeAll, vi } from "vitest";
import type { EntityConfig } from "@/types/entity";

// Mock the Supabase client to avoid env var requirements during import.
// Several entity configs transitively import components that call
// createClient() at module scope (e.g., revision-history.tsx).
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ data: [], error: null }),
    }),
  }),
}));

import { entityRegistry } from "@/types/entity";

// Import the entity registry module to trigger registration of all entities
import "@/entities/index";

let entitiesWithRequiresAction: EntityConfig<Record<string, unknown>>[] = [];

beforeAll(() => {
  expect(entityRegistry.size).toBeGreaterThan(0);
  entitiesWithRequiresAction = Array.from(entityRegistry.values()).filter(
    (e) => e.stateMachine?.requiresAction
  );
});

describe("stateMachine.requiresAction integrity", () => {
  it("every requiresAction target is a valid, reachable state", () => {
    for (const entity of entitiesWithRequiresAction) {
      const sm = entity.stateMachine!;
      for (const target of Object.keys(sm.requiresAction!)) {
        expect(
          sm.states,
          `${entity.name}: requiresAction target "${target}" is not a state`
        ).toContain(target);

        const reachable = Object.values(sm.transitions).some((tos) =>
          tos.includes(target)
        );
        expect(
          reachable,
          `${entity.name}: requiresAction target "${target}" is unreachable in transitions`
        ).toBe(true);
      }
    }
  });

  it("every requiresAction names an existing action targeting that state", () => {
    for (const entity of entitiesWithRequiresAction) {
      const sm = entity.stateMachine!;
      for (const [target, actionName] of Object.entries(sm.requiresAction!)) {
        const action = entity.actions?.find((a) => a.name === actionName);
        expect(
          action,
          `${entity.name}: requiresAction["${target}"] names unknown action "${actionName}"`
        ).toBeDefined();
        expect(
          action!.toState,
          `${entity.name}: action "${actionName}" must target "${target}" so it can stand in for the suppressed generic transition`
        ).toBe(target);
      }
    }
  });

  it("the named action is available from every state the target is reachable from", () => {
    // Otherwise suppressing the generic "Move to {state}" item would strand
    // the transition: no generic item AND no applicable action.
    for (const entity of entitiesWithRequiresAction) {
      const sm = entity.stateMachine!;
      for (const [target, actionName] of Object.entries(sm.requiresAction!)) {
        const action = entity.actions?.find((a) => a.name === actionName);
        if (!action?.fromStates) continue; // ungated action — always available

        const sourceStates = Object.entries(sm.transitions)
          .filter(([, tos]) => tos.includes(target))
          .map(([from]) => from);

        for (const from of sourceStates) {
          expect(
            action.fromStates,
            `${entity.name}: "${from}" -> "${target}" is a valid transition but action "${actionName}" is not available from "${from}"`
          ).toContain(from);
        }
      }
    }
  });
});

describe("batch requiresAction", () => {
  it("routes terminal batch states through the cancel/archive actions", () => {
    const batch = entityRegistry.get("batch");
    expect(batch?.stateMachine?.requiresAction).toEqual({
      cancelled: "cancel",
      archived: "archive",
    });
  });
});
