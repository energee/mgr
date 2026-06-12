/**
 * EntityActionDef.transitionFields Validation Tests
 *
 * `transitionFields` declares fields collected by a small pre-transition
 * dialog and merged into the same UPDATE payload as the status flip (see
 * src/types/entity.ts and entity-transition-fields-dialog.tsx). These tests
 * validate the config's integrity for every registered entity, plus the
 * specific orders.schedule / pick_lists.assign wiring (audit finding 32).
 */

import { describe, it, expect, beforeAll, vi } from "vitest";
import type { EntityConfig, EntityActionDef } from "@/types/entity";

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

import { entityRegistry, getTransitionFieldsAction } from "@/types/entity";

// Import the entity registry module to trigger registration of all entities
import "@/entities/index";

type AnyEntity = EntityConfig<Record<string, unknown>>;
type AnyAction = EntityActionDef<Record<string, unknown>>;

let actionsWithTransitionFields: { entity: AnyEntity; action: AnyAction }[] = [];

beforeAll(() => {
  expect(entityRegistry.size).toBeGreaterThan(0);
  actionsWithTransitionFields = Array.from(entityRegistry.values()).flatMap(
    (entity) =>
      (entity.actions ?? [])
        .filter((a) => a.transitionFields?.length)
        .map((action) => ({ entity, action }))
  );
  // The feature is wired for at least orders.schedule and pick_lists.assign
  expect(actionsWithTransitionFields.length).toBeGreaterThanOrEqual(2);
});

describe("EntityActionDef.transitionFields integrity", () => {
  it("transitionFields only appears on state-transition actions", () => {
    for (const { entity, action } of actionsWithTransitionFields) {
      expect(
        action.toState,
        `${entity.name}.${action.name}: transitionFields requires toState — the values ride in the transition UPDATE`
      ).toBeTruthy();
    }
  });

  it("field names are unique and never collide with the state field", () => {
    for (const { entity, action } of actionsWithTransitionFields) {
      const names = action.transitionFields!.map((f) => f.name);
      expect(
        new Set(names).size,
        `${entity.name}.${action.name}: duplicate transitionFields names`
      ).toBe(names.length);
      expect(
        names,
        `${entity.name}.${action.name}: a transition field must not target the state field (the status flip would clobber it)`
      ).not.toContain(entity.stateMachine?.stateField);
    }
  });

  it("select/relation fields declare an options source", () => {
    for (const { entity, action } of actionsWithTransitionFields) {
      for (const field of action.transitionFields!) {
        if (field.type === "relation") {
          expect(
            field.relation,
            `${entity.name}.${action.name}.${field.name}: type "relation" needs a relation config`
          ).toBeDefined();
        }
        if (field.type === "select") {
          expect(
            field.options || field.dynamicOptions,
            `${entity.name}.${action.name}.${field.name}: type "select" needs options or dynamicOptions`
          ).toBeTruthy();
        }
      }
    }
  });

  it("the target state is owned via stateMachine.requiresAction so bulk updates can't bare-flip past the dialog", () => {
    for (const { entity, action } of actionsWithTransitionFields) {
      expect(
        entity.stateMachine?.requiresAction?.[action.toState!],
        `${entity.name}.${action.name}: pair transitionFields with requiresAction["${action.toState}"] (see EntityActionDef.transitionFields JSDoc)`
      ).toBe(action.name);
    }
  });
});

describe("getTransitionFieldsAction", () => {
  it("resolves the orders schedule action for the scheduled state", () => {
    const order = entityRegistry.get("order")!;
    expect(getTransitionFieldsAction(order, "scheduled")?.name).toBe("schedule");
    // States without a transition-fields action stay bare flips
    expect(getTransitionFieldsAction(order, "confirmed")).toBeUndefined();
    expect(getTransitionFieldsAction(order, "fulfilled")).toBeUndefined();
  });

  it("resolves the pick list assign action for the assigned state", () => {
    const pickList = entityRegistry.get("pick_list")!;
    expect(getTransitionFieldsAction(pickList, "assigned")?.name).toBe("assign");
    expect(getTransitionFieldsAction(pickList, "in_progress")).toBeUndefined();
  });
});

describe("orders.schedule transitionFields", () => {
  it("collects scheduled_date, defaulting to the order's requested_date", () => {
    const order = entityRegistry.get("order")!;
    const schedule = order.actions!.find((a) => a.name === "schedule")!;
    const field = schedule.transitionFields!.find(
      (f) => f.name === "scheduled_date"
    )!;
    expect(field.type).toBe("date");
    expect(field.required).toBe(true);
    expect(
      field.defaultValue?.({ requested_date: "2026-06-20" })
    ).toBe("2026-06-20");
  });
});

describe("pick_lists.assign transitionFields", () => {
  it("collects assigned_to from the user_profile relation", () => {
    const pickList = entityRegistry.get("pick_list")!;
    const assign = pickList.actions!.find((a) => a.name === "assign")!;
    const field = assign.transitionFields!.find((f) => f.name === "assigned_to")!;
    expect(field.type).toBe("relation");
    expect(field.required).toBe(true);
    expect(field.relation).toEqual({
      entity: "user_profile",
      displayField: "display_name",
    });
  });
});
