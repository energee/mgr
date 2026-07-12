/**
 * Create-Mode State Tests (audit EA-1 + EA-9, backlog 2026-07-10 #13)
 *
 * New records must enter their lifecycle at the state machine's initial
 * state. An INSERT is invisible to the server-side transition triggers
 * (migrations 00143/00205 fire on UPDATE only) and to the transition
 * side-effect registry (src/services/transition-side-effects.ts), so a
 * record created directly in a later state — e.g. a packaging session
 * created as "Completed" — would skip material depletion, FG creation, and
 * every other transition effect, then sit read-only and inconsistent.
 *
 * Asserts, for every registered entity with a stateMachine:
 * 1. Every create-editable state select is clamped to exactly the machine's
 *    initial state (isCreateModeStateField wiring + createModeStateOptions).
 * 2. The formSchema (wrapped centrally by resolveServerCore's
 *    withStateFieldGuard) rejects strings outside the state machine and
 *    accepts every machine state — cross-checking hand-typed z.enum literals
 *    against the machine's states list (the 93f944a3 drift failure mode).
 * 3. The set of stateful entities whose formSchema does NOT carry the state
 *    field (DB default supplies it) is pinned, so silent drift is visible.
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

import { entityRegistry, createModeStateOptions } from "@/types/entity";
import {
  isFieldEditable,
  isCreateModeStateField,
} from "@/components/universal/unified-field";

// Import the entity registry module to trigger registration of all entities
import "@/entities/index";

type AnyEntity = EntityConfig<Record<string, unknown>>;
type AnyField = UnifiedFieldDef<Record<string, unknown>>;

let statefulEntities: AnyEntity[] = [];

beforeAll(() => {
  statefulEntities = Array.from(entityRegistry.values()).filter(
    (e) => !!e.stateMachine
  );
  expect(statefulEntities.length).toBeGreaterThan(0);
});

/**
 * Minimal valid form payloads (state field omitted) per stateful entity.
 * Only entities with required non-state fields need an entry; the rest
 * parse from {} via schema defaults/optionality.
 */
const FIXTURES: Record<string, Record<string, unknown>> = {
  batch: { name: "Test Batch" },
  order: { order_number: "SO-TEST-1", order_date: "2026-07-11" },
  purchase_order: { po_number: "PO-TEST-1", order_date: "2026-07-11" },
  packaging_session: { session_date: "2026-07-11" },
  brew_log: { brew_date: "2026-07-11" },
  allocation: {
    source_type: "finished_good",
    destination_type: "order",
    quantity: 1,
  },
  // Zod v4's uuid() requires a valid version nibble — use a v4-shaped id.
  pick_list: { order_id: "11111111-1111-4111-8111-111111111111" },
  recipe: { name: "Test Recipe" },
  vessel: { name: "FV-Test", vessel_type: "fermenter", capacity_bbl: 10 },
  yeast_pitch: {
    strain_id: "11111111-1111-4111-8111-111111111111",
    source_type: "purchase",
  },
  user_profile: { display_name: "Test User", roles: ["viewer"] },
};

/**
 * Stateful entities whose formSchema intentionally omits the state field:
 * their INSERTs never carry a status, so the DB column default supplies the
 * initial state. Pinned so a new stateful entity that forgets its status
 * validation shows up here instead of silently skipping the schema tests.
 */
const SCHEMA_OMITS_STATE_FIELD = new Set(["delivery", "location_transfer"]);

/** Whether the entity's (ZodObject) formSchema declares the state field. */
function schemaHasStateField(entity: AnyEntity): boolean {
  const shape = (
    entity.formSchema as unknown as { shape?: Record<string, unknown> }
  ).shape;
  return !!shape && entity.stateMachine!.stateField in shape;
}

/** [entity, field] pairs where a section field matches the state field. */
function stateFieldDefs(): [AnyEntity, AnyField][] {
  const pairs: [AnyEntity, AnyField][] = [];
  for (const entity of statefulEntities) {
    for (const section of entity.sections ?? []) {
      for (const field of section.fields ?? []) {
        if (field.name === entity.stateMachine!.stateField) {
          pairs.push([entity, field]);
        }
      }
    }
  }
  return pairs;
}

describe("Entity configs: create-mode state options (EA-1)", () => {
  it("every create-editable state field is recognized by the clamp condition", () => {
    let createEditable = 0;
    for (const [entity, field] of stateFieldDefs()) {
      if (!isFieldEditable(field, true, true, entity)) continue;
      createEditable++;
      expect(
        isCreateModeStateField(field, true, entity),
        `${entity.name}: create-editable state field '${field.name}' must be ` +
          `clamped by UnifiedField's create-mode state clamp`
      ).toBe(true);
    }
    // Sanity: the assertion above is not vacuous (batch, packaging_session,
    // recipe, pick_list, brew_log, user_profile, yeast_pitch, vessel today).
    expect(createEditable).toBeGreaterThanOrEqual(5);
  });

  it("clamped create options offer exactly the machine's initial state", () => {
    for (const [entity, field] of stateFieldDefs()) {
      const options = createModeStateOptions(entity.stateMachine!, field.options);
      expect(
        options.map((o) => o.value),
        `${entity.name}: create-mode state options must be [initialState]`
      ).toEqual([entity.stateMachine!.initialState]);
      // Labels come from the authored options / stateDisplay, never empty.
      expect(options[0].label).toBeTruthy();
    }
  });

  it("the clamp never fires outside create mode or for non-state fields", () => {
    const [entity, field] = stateFieldDefs()[0];
    expect(isCreateModeStateField(field, false, entity)).toBe(false);
    expect(
      isCreateModeStateField(
        { ...field, name: "definitely_not_the_state_field" },
        true,
        entity
      )
    ).toBe(false);
  });
});

describe("Entity configs: state field schema membership (EA-9)", () => {
  it("pins which stateful entities omit the state field from their schema", () => {
    const omitted = statefulEntities
      .filter((e) => !schemaHasStateField(e))
      .map((e) => e.name)
      .sort();
    expect(omitted).toEqual([...SCHEMA_OMITS_STATE_FIELD].sort());
  });

  it("rejects a non-machine state on every schema that carries the state field", () => {
    for (const entity of statefulEntities) {
      if (!schemaHasStateField(entity)) continue;
      const stateField = entity.stateMachine!.stateField;
      const result = entity.formSchema.safeParse({
        ...(FIXTURES[entity.name] ?? {}),
        [stateField]: "__not_a_machine_state__",
      });
      expect(
        result.success,
        `${entity.name}: formSchema accepted a status outside the state machine`
      ).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i) => i.path[0] === stateField),
          `${entity.name}: expected a validation issue on '${stateField}', ` +
            `got: ${JSON.stringify(result.error.issues)}`
        ).toBe(true);
      }
    }
  });

  it("accepts every machine state (enum literals cannot drift from the machine)", () => {
    for (const entity of statefulEntities) {
      if (!schemaHasStateField(entity)) continue;
      const stateField = entity.stateMachine!.stateField;
      for (const state of entity.stateMachine!.states) {
        const result = entity.formSchema.safeParse({
          ...(FIXTURES[entity.name] ?? {}),
          [stateField]: state,
        });
        expect(
          result.success,
          `${entity.name}: formSchema rejected machine state '${state}': ` +
            `${!result.success ? JSON.stringify(result.error.issues) : ""}`
        ).toBe(true);
      }
    }
  });

  it("defaults the state field to the machine's initial state when omitted", () => {
    for (const entity of statefulEntities) {
      if (!schemaHasStateField(entity)) continue;
      const result = entity.formSchema.safeParse(FIXTURES[entity.name] ?? {});
      expect(
        result.success,
        `${entity.name}: fixture failed to parse: ` +
          `${!result.success ? JSON.stringify(result.error.issues) : ""}`
      ).toBe(true);
      if (result.success) {
        expect(
          (result.data as Record<string, unknown>)[
            entity.stateMachine!.stateField
          ],
          `${entity.name}: schema default must equal stateMachine.initialState`
        ).toBe(entity.stateMachine!.initialState);
      }
    }
  });
});
