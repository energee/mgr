/**
 * State Field Lock Tests
 *
 * Status/state changes must go through the guarded transition path (Actions
 * menu -> transitionMutation), which validates the transition against the
 * state machine and runs transition side effects. A plain form save does
 * neither, so the state field must never be form-editable when editing an
 * existing record.
 *
 * Asserts that for every registered entity with a stateMachine, any section
 * field matching stateMachine.stateField is locked in edit mode — either via
 * an explicit `editable: false` on the field def, or via the framework lock
 * in isFieldEditable (unified-field.tsx). Also asserts the lock does not
 * affect create mode for fields that are otherwise editable.
 */

import { describe, it, expect, beforeAll, vi } from "vitest";
import type { EntityConfig, UnifiedFieldDef } from "@/types/entity";

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
import { isFieldEditable } from "@/components/universal/unified-field";

// Import the entity registry module to trigger registration of all entities
import "@/entities/index";

type AnyEntity = EntityConfig<Record<string, unknown>>;
type AnyField = UnifiedFieldDef<Record<string, unknown>>;

let allEntities: AnyEntity[] = [];

beforeAll(() => {
  allEntities = Array.from(entityRegistry.values());
  expect(allEntities.length).toBeGreaterThan(0);
});

/** Collect [entity, field] pairs where a section field matches the state field. */
function stateFieldDefs(): [AnyEntity, AnyField][] {
  const pairs: [AnyEntity, AnyField][] = [];
  for (const entity of allEntities) {
    if (!entity.stateMachine || !entity.sections) continue;
    for (const section of entity.sections) {
      for (const field of section.fields ?? []) {
        if (field.name === entity.stateMachine.stateField) {
          pairs.push([entity, field]);
        }
      }
    }
  }
  return pairs;
}

describe("Entity configs: state field lock", () => {
  it("finds state fields in sections to validate", () => {
    // Sanity check: the assertion below is not vacuous.
    expect(stateFieldDefs().length).toBeGreaterThan(0);
  });

  it("every state-machine state field is non-editable when editing an existing record", () => {
    for (const [entity, field] of stateFieldDefs()) {
      // editing=true, isCreateMode=false: the field must be locked, either
      // by an explicit editable:false or by the framework stateField lock.
      expect(
        isFieldEditable(field, true, false, entity),
        `${entity.name}: state field '${field.name}' is form-editable in edit mode; ` +
          `status must only change via the guarded transition path`
      ).toBe(false);
    }
  });

  it("the framework lock does not affect create mode", () => {
    for (const [entity, field] of stateFieldDefs()) {
      // Fields without an explicit editable restriction stay editable at
      // create time. Note the create form still only OFFERS the machine's
      // initial state — see create-mode-state.test.ts (audit EA-1).
      if (field.editable === false || !field.type) continue;
      expect(
        isFieldEditable(field, true, true, entity),
        `${entity.name}: state field '${field.name}' should remain editable in create mode`
      ).toBe(true);
    }
  });
});
