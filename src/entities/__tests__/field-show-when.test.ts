/**
 * Field-level showWhen Support Tests (audit finding 06)
 *
 * UnifiedFieldDef.showWhen declares conditional field visibility. The
 * framework honors it in FieldGrid (entity-detail-unified.tsx): in
 * edit/create mode visibility tracks live form values via useWatch, in view
 * mode it evaluates against the loaded record, and on save user-entered
 * (dirty) values of hidden-at-save fields are nulled so a value picked
 * before the field became hidden is never persisted — while programmatic
 * values (URL-prefill defaults, loaded record values) survive, since e.g.
 * keg_inventory is calculated from stored from/to states.
 *
 * These tests assert that support via the exported pure helpers
 * (isFieldVisible, nullHiddenDirtyFieldValues), exercise the live
 * keg-transaction usages, and enforce a registry-wide config invariant:
 * a field with showWhen must not be `required` (a hidden required field
 * could never be filled in, dead-ending the save).
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
import {
  isFieldVisible,
  nullHiddenDirtyFieldValues,
} from "@/components/universal/entity-detail-unified";
import { kegTransactionEntity } from "@/entities/keg-transaction";

// Import the entity registry module to trigger registration of all entities
import "@/entities/index";

type AnyEntity = EntityConfig<Record<string, unknown>>;
type AnyField = UnifiedFieldDef<Record<string, unknown>>;

let allEntities: AnyEntity[] = [];

beforeAll(() => {
  allEntities = Array.from(entityRegistry.values());
  expect(allEntities.length).toBeGreaterThan(0);
});

/** Collect [entity, field] pairs for every section field declaring showWhen. */
function showWhenFieldDefs(): [AnyEntity, AnyField][] {
  const pairs: [AnyEntity, AnyField][] = [];
  for (const entity of allEntities) {
    for (const section of entity.sections ?? []) {
      for (const field of section.fields ?? []) {
        if (field.showWhen) pairs.push([entity, field]);
      }
    }
  }
  return pairs;
}

// Widen the specifically-typed config to the registry-wide shape so test
// values can be plain Record<string, unknown> (mirrors how the framework
// consumes configs).
const kegEntity = kegTransactionEntity as unknown as AnyEntity;

/** Find a section field by name on an entity config. */
function getField(entity: AnyEntity, name: string): AnyField {
  const field = entity.sections
    ?.flatMap((s) => s.fields ?? [])
    .find((f) => f.name === name);
  expect(field, `field '${name}' not found on ${entity.name}`).toBeDefined();
  return field!;
}

describe("Framework support: isFieldVisible", () => {
  it("fields without showWhen are always visible", () => {
    const field: AnyField = { name: "notes", label: "Notes", type: "text" };
    expect(isFieldVisible(field, {})).toBe(true);
    expect(isFieldVisible(field, { anything: "x" })).toBe(true);
  });

  it("evaluates showWhen against the provided values", () => {
    const field: AnyField = {
      name: "reason",
      label: "Reason",
      type: "text",
      showWhen: (values) => values.kind === "adjust",
    };
    expect(isFieldVisible(field, { kind: "adjust" })).toBe(true);
    expect(isFieldVisible(field, { kind: "fill" })).toBe(false);
    expect(isFieldVisible(field, {})).toBe(false);
  });
});

describe("Framework support: nullHiddenDirtyFieldValues", () => {
  const fields: AnyField[] = [
    { name: "kind", label: "Kind", type: "select" },
    {
      name: "reason",
      label: "Reason",
      type: "text",
      showWhen: (values) => values.kind === "adjust",
    },
  ];

  it("nulls a dirty value whose field is hidden at save time", () => {
    // User picked "adjust", typed a reason, then switched kind to "fill":
    // the stale reason must not be persisted.
    const values: Record<string, unknown> = { kind: "fill", reason: "oops" };
    nullHiddenDirtyFieldValues(values, fields, { kind: true, reason: true });
    expect(values.reason).toBeNull();
  });

  it("keeps a dirty value whose field is visible at save time", () => {
    const values: Record<string, unknown> = { kind: "adjust", reason: "stocktake" };
    nullHiddenDirtyFieldValues(values, fields, { kind: true, reason: true });
    expect(values.reason).toBe("stocktake");
  });

  it("keeps non-dirty (programmatic) values even when the field is hidden", () => {
    // URL-prefill defaults and loaded record values are not dirty; nulling
    // them would corrupt derived data (e.g. keg_inventory from from/to states).
    const values: Record<string, unknown> = { kind: "fill", reason: "derived" };
    nullHiddenDirtyFieldValues(values, fields, { kind: true });
    expect(values.reason).toBe("derived");
  });

  it("evaluates visibility against a snapshot, order-independently", () => {
    // Hiding/nulling one field must not change another field's check within
    // the same pass: both predicates below see the original "fill" value.
    const chained: AnyField[] = [
      {
        name: "a",
        label: "A",
        type: "text",
        showWhen: (values) => values.kind !== "fill",
      },
      {
        name: "b",
        label: "B",
        type: "text",
        // Depends on `a`, which is nulled in the same pass — the snapshot
        // guarantees this predicate still sees the pre-pass value of `a`.
        showWhen: (values) => values.a === "set",
      },
    ];
    const values: Record<string, unknown> = { kind: "fill", a: "set", b: "kept" };
    nullHiddenDirtyFieldValues(values, chained, { a: true, b: true });
    expect(values.a).toBeNull();
    // `b` stays: its predicate saw the snapshot where a === "set".
    expect(values.b).toBe("kept");
  });
});

describe("keg-transaction showWhen wiring", () => {
  it("from_state shows only for maintain/retire/adjust", () => {
    const fromState = getField(kegEntity, "from_state");
    expect(fromState.showWhen).toBeDefined();
    for (const type of ["maintain", "retire", "adjust"]) {
      expect(
        isFieldVisible(fromState, { transaction_type: type }),
        `from_state should be visible for '${type}'`
      ).toBe(true);
    }
    for (const type of ["receive", "fill", "ship", "return", "clean"]) {
      expect(
        isFieldVisible(fromState, { transaction_type: type }),
        `from_state should be hidden for '${type}'`
      ).toBe(false);
    }
  });

  it("to_state shows only for adjust", () => {
    const toState = getField(kegEntity, "to_state");
    expect(toState.showWhen).toBeDefined();
    expect(isFieldVisible(toState, { transaction_type: "adjust" })).toBe(true);
    for (const type of ["receive", "fill", "ship", "return", "clean", "maintain", "retire"]) {
      expect(
        isFieldVisible(toState, { transaction_type: type }),
        `to_state should be hidden for '${type}'`
      ).toBe(false);
    }
  });
});

describe("Entity configs: showWhen invariants", () => {
  it("finds showWhen fields in the registry to validate", () => {
    // Sanity check: the assertions below are not vacuous.
    expect(showWhenFieldDefs().length).toBeGreaterThan(0);
  });

  it("no showWhen field is required", () => {
    // A hidden required field can never be filled in, so the zod schema
    // would dead-end the save with an error on an invisible input. Hidden
    // values are also nulled at save when dirty, conflicting with required.
    for (const [entity, field] of showWhenFieldDefs()) {
      expect(
        field.required,
        `${entity.name}: field '${field.name}' declares showWhen and required; ` +
          `a hidden required field dead-ends the save`
      ).not.toBe(true);
    }
  });
});
