/**
 * Tests for entity helper functions exported from @/types/entity.
 *
 * Covers: statesAsOptions, createModeStateOptions, clampCreateStateField,
 * formatStateLabel, getStateLabel, valuesAsOptions, getValueDisplay,
 * getValueLabel, resolveServerCore (incl. the state-field schema guard).
 */

import { describe, it, expect } from "vitest";
import {
  statesAsOptions,
  createModeStateOptions,
  clampCreateStateField,
  formatStateLabel,
  getStateLabel,
  valuesAsOptions,
  getValueDisplay,
  getValueLabel,
  getValueColor,
} from "@/types/entity";
import type {
  EntityConfig,
  StateMachineConfig,
  ValueDisplayConfig,
} from "@/types/entity";

// =============================================================================
// Fixtures — minimal mock configs for focused edge-case testing
// =============================================================================

/** State machine with full stateDisplay for all states. */
const fullStateMachine: StateMachineConfig<Record<string, unknown>> = {
  stateField: "status",
  states: ["draft", "active", "completed"],
  initialState: "draft",
  transitions: {
    draft: ["active"],
    active: ["completed"],
    completed: [],
  },
  stateDisplay: {
    draft: { label: "Draft", color: "default" },
    active: { label: "Active", color: "info" },
    completed: { label: "Completed", color: "success" },
  },
};

/** State machine with NO stateDisplay at all. */
const noDisplayStateMachine: StateMachineConfig<Record<string, unknown>> = {
  stateField: "status",
  states: ["in_progress", "on_hold", "done"],
  initialState: "in_progress",
  transitions: {
    in_progress: ["on_hold", "done"],
    on_hold: ["in_progress"],
    done: [],
  },
};

/** State machine with partial stateDisplay (only some states defined). */
const partialDisplayStateMachine: StateMachineConfig<Record<string, unknown>> =
  {
    stateField: "status",
    states: ["pending", "reviewed", "approved"],
    initialState: "pending",
    transitions: {
      pending: ["reviewed"],
      reviewed: ["approved"],
      approved: [],
    },
    stateDisplay: {
      approved: { label: "Approved", color: "success" },
    },
  };

/** Value display config with colors. */
const priorityDisplay: ValueDisplayConfig = {
  field: "priority",
  display: {
    low: { label: "Low", color: "default" },
    medium: { label: "Medium", color: "warning" },
    high: { label: "High", color: "error" },
    critical: { label: "Critical", color: "error" },
  },
};

/** Value display config without colors. */
const categoryDisplay: ValueDisplayConfig = {
  field: "category",
  display: {
    grain: { label: "Grain" },
    hop: { label: "Hop" },
    yeast: { label: "Yeast" },
  },
};

/** Minimal entity config with state machine and value display. */
const mockEntity: EntityConfig<Record<string, unknown>> = {
  name: "mock",
  table: "mocks",
  displayName: "Mock",
  displayNamePlural: "Mocks",
  domain: "production",
  listColumns: [],
  formSchema: {} as EntityConfig<Record<string, unknown>>["formSchema"],
  stateMachine: fullStateMachine,
  valueDisplay: [priorityDisplay, categoryDisplay],
};

/** Entity with no state machine and no value display. */
const bareEntity: EntityConfig<Record<string, unknown>> = {
  name: "bare",
  table: "bares",
  displayName: "Bare",
  displayNamePlural: "Bares",
  domain: "inventory",
  listColumns: [],
  formSchema: {} as EntityConfig<Record<string, unknown>>["formSchema"],
};

/** Entity with state machine but no stateDisplay. */
const noDisplayEntity: EntityConfig<Record<string, unknown>> = {
  name: "no_display",
  table: "no_displays",
  displayName: "No Display",
  displayNamePlural: "No Displays",
  domain: "production",
  listColumns: [],
  formSchema: {} as EntityConfig<Record<string, unknown>>["formSchema"],
  stateMachine: noDisplayStateMachine,
};

// =============================================================================
// statesAsOptions
// =============================================================================

describe("statesAsOptions", () => {
  it("returns options with value and label from stateDisplay", () => {
    const options = statesAsOptions(fullStateMachine);
    expect(options).toEqual([
      { value: "draft", label: "Draft" },
      { value: "active", label: "Active" },
      { value: "completed", label: "Completed" },
    ]);
  });

  it("falls back to formatStateLabel when stateDisplay is missing", () => {
    const options = statesAsOptions(noDisplayStateMachine);
    expect(options).toEqual([
      { value: "in_progress", label: "In Progress" },
      { value: "on_hold", label: "On Hold" },
      { value: "done", label: "Done" },
    ]);
  });

  it("mixes stateDisplay labels with formatted labels for partial config", () => {
    const options = statesAsOptions(partialDisplayStateMachine);
    expect(options).toEqual([
      { value: "pending", label: "Pending" },
      { value: "reviewed", label: "Reviewed" },
      { value: "approved", label: "Approved" },
    ]);
  });

  it("returns empty array for empty states list", () => {
    const empty: StateMachineConfig<Record<string, unknown>> = {
      stateField: "status",
      states: [],
      initialState: "",
      transitions: {},
    };
    expect(statesAsOptions(empty)).toEqual([]);
  });
});

// =============================================================================
// createModeStateOptions (audit EA-1)
// =============================================================================

describe("createModeStateOptions", () => {
  it("returns only the initial state, labeled from stateDisplay", () => {
    expect(createModeStateOptions(fullStateMachine)).toEqual([
      { value: "draft", label: "Draft" },
    ]);
  });

  it("prefers the authored option's label when provided", () => {
    const options = createModeStateOptions(fullStateMachine, [
      { value: "draft", label: "Custom Draft Label" },
      { value: "active", label: "Active" },
    ]);
    expect(options).toEqual([{ value: "draft", label: "Custom Draft Label" }]);
  });

  it("falls back to a formatted label without stateDisplay", () => {
    expect(createModeStateOptions(noDisplayStateMachine)).toEqual([
      { value: "in_progress", label: "In Progress" },
    ]);
  });

  it("ignores authored options that lack the initial state", () => {
    const options = createModeStateOptions(fullStateMachine, [
      { value: "completed", label: "Completed" },
    ]);
    expect(options).toEqual([{ value: "draft", label: "Draft" }]);
  });
});

// =============================================================================
// clampCreateStateField (audit EA-1)
// =============================================================================

describe("clampCreateStateField", () => {
  it("forces a staged later state back to the initial state", () => {
    const data: Record<string, unknown> = { name: "X", status: "completed" };
    clampCreateStateField(fullStateMachine, data);
    expect(data.status).toBe("draft");
  });

  it("leaves payloads without the state field untouched", () => {
    const data: Record<string, unknown> = { name: "X" };
    clampCreateStateField(fullStateMachine, data);
    expect("status" in data).toBe(false);
  });

  it("is a no-op without a state machine", () => {
    const data: Record<string, unknown> = { status: "anything" };
    clampCreateStateField(undefined, data);
    expect(data.status).toBe("anything");
  });
});

// =============================================================================
// formatStateLabel
// =============================================================================

describe("formatStateLabel", () => {
  it("converts snake_case to Title Case", () => {
    expect(formatStateLabel("in_progress")).toBe("In Progress");
  });

  it("converts kebab-case to Title Case", () => {
    expect(formatStateLabel("ready-for-use")).toBe("Ready For Use");
  });

  it("handles single word states", () => {
    expect(formatStateLabel("draft")).toBe("Draft");
  });

  it("handles already capitalized input", () => {
    expect(formatStateLabel("ACTIVE")).toBe("Active");
  });

  it("handles mixed separators", () => {
    expect(formatStateLabel("needs_re-review")).toBe("Needs Re Review");
  });

  it("handles empty string gracefully", () => {
    expect(formatStateLabel("")).toBe("");
  });

  it("handles single character segments", () => {
    expect(formatStateLabel("a_b_c")).toBe("A B C");
  });
});

// =============================================================================
// getStateLabel
// =============================================================================

describe("getStateLabel", () => {
  it("returns label from stateDisplay when available", () => {
    expect(getStateLabel(mockEntity, "draft")).toBe("Draft");
    expect(getStateLabel(mockEntity, "active")).toBe("Active");
    expect(getStateLabel(mockEntity, "completed")).toBe("Completed");
  });

  it("falls back to formatStateLabel when stateDisplay is missing", () => {
    expect(getStateLabel(noDisplayEntity, "in_progress")).toBe("In Progress");
    expect(getStateLabel(noDisplayEntity, "on_hold")).toBe("On Hold");
  });

  it("falls back to formatStateLabel for unknown states", () => {
    expect(getStateLabel(mockEntity, "some_unknown_state")).toBe(
      "Some Unknown State"
    );
  });

  it("returns empty string for null state", () => {
    expect(getStateLabel(mockEntity, null)).toBe("");
  });

  it("returns empty string for undefined state", () => {
    expect(getStateLabel(mockEntity, undefined)).toBe("");
  });

  it("handles entity without stateMachine", () => {
    expect(getStateLabel(bareEntity, "active")).toBe("Active");
  });
});

// =============================================================================
// valuesAsOptions
// =============================================================================

describe("valuesAsOptions", () => {
  it("converts ValueDisplayConfig to options array", () => {
    const options = valuesAsOptions(priorityDisplay);
    expect(options).toEqual([
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
      { value: "critical", label: "Critical" },
    ]);
  });

  it("works with config that has no colors", () => {
    const options = valuesAsOptions(categoryDisplay);
    expect(options).toEqual([
      { value: "grain", label: "Grain" },
      { value: "hop", label: "Hop" },
      { value: "yeast", label: "Yeast" },
    ]);
  });

  it("returns empty array for empty display config", () => {
    const empty: ValueDisplayConfig = {
      field: "empty",
      display: {},
    };
    expect(valuesAsOptions(empty)).toEqual([]);
  });
});

// =============================================================================
// getValueDisplay
// =============================================================================

describe("getValueDisplay", () => {
  it("returns correct display info for a known field and value", () => {
    const display = getValueDisplay(mockEntity, "priority", "high");
    expect(display).toEqual({ label: "High", color: "error" });
  });

  it("returns display without color when color is not set", () => {
    const display = getValueDisplay(mockEntity, "category", "grain");
    expect(display).toEqual({ label: "Grain" });
  });

  it("returns undefined for unknown value in known field", () => {
    const display = getValueDisplay(mockEntity, "priority", "unknown_val");
    expect(display).toBeUndefined();
  });

  it("returns undefined for unknown field", () => {
    const display = getValueDisplay(mockEntity, "nonexistent_field", "some_val");
    expect(display).toBeUndefined();
  });

  it("returns undefined for null value", () => {
    expect(getValueDisplay(mockEntity, "priority", null)).toBeUndefined();
  });

  it("returns undefined for undefined value", () => {
    expect(getValueDisplay(mockEntity, "priority", undefined)).toBeUndefined();
  });

  it("returns undefined for entity without valueDisplay", () => {
    expect(getValueDisplay(bareEntity, "priority", "high")).toBeUndefined();
  });
});

// =============================================================================
// getValueLabel
// =============================================================================

describe("getValueLabel", () => {
  it("returns label from valueDisplay when available", () => {
    expect(getValueLabel(mockEntity, "priority", "medium")).toBe("Medium");
    expect(getValueLabel(mockEntity, "category", "hop")).toBe("Hop");
  });

  it("falls back to formatStateLabel for unknown value", () => {
    expect(getValueLabel(mockEntity, "priority", "super_high")).toBe(
      "Super High"
    );
  });

  it("falls back to formatStateLabel for unknown field", () => {
    expect(getValueLabel(mockEntity, "unknown_field", "some_value")).toBe(
      "Some Value"
    );
  });

  it("returns empty string for null value", () => {
    expect(getValueLabel(mockEntity, "priority", null)).toBe("");
  });

  it("returns empty string for undefined value", () => {
    expect(getValueLabel(mockEntity, "priority", undefined)).toBe("");
  });

  it("returns formatted label for entity without valueDisplay", () => {
    expect(getValueLabel(bareEntity, "field", "some_value")).toBe("Some Value");
  });
});

// =============================================================================
// getValueColor
// =============================================================================

describe("getValueColor", () => {
  it("returns color from valueDisplay when available", () => {
    expect(getValueColor(mockEntity, "priority", "low")).toBe("default");
    expect(getValueColor(mockEntity, "priority", "medium")).toBe("warning");
    expect(getValueColor(mockEntity, "priority", "high")).toBe("error");
  });

  it('returns "default" for value without color', () => {
    expect(getValueColor(mockEntity, "category", "grain")).toBe("default");
  });

  it('returns "default" for unknown value in known field', () => {
    expect(getValueColor(mockEntity, "priority", "unknown")).toBe("default");
  });

  it('returns "default" for unknown field', () => {
    expect(getValueColor(mockEntity, "nonexistent", "val")).toBe("default");
  });

  it('returns "default" for null value', () => {
    expect(getValueColor(mockEntity, "priority", null)).toBe("default");
  });

  it('returns "default" for undefined value', () => {
    expect(getValueColor(mockEntity, "priority", undefined)).toBe("default");
  });

  it('returns "default" for entity without valueDisplay', () => {
    expect(getValueColor(bareEntity, "field", "val")).toBe("default");
  });
});

// =============================================================================
// resolveServerCore
// =============================================================================

import { resolveServerCore } from "@/types/entity";
import type { EntityCoreInput } from "@/types/entity";
import { z } from "zod";

describe("resolveServerCore", () => {
  const baseCore: EntityCoreInput<{ id: string; name: string; status: string }> = {
    name: "widget",
    table: "widgets",
    displayName: "Widget",
    domain: "production",
    formSchema: z.object({}),
  };

  it("defaults displayNamePlural to `${displayName}s` when omitted", () => {
    const resolved = resolveServerCore(baseCore);
    expect(resolved.displayNamePlural).toBe("Widgets");
  });

  it("preserves an explicit displayNamePlural (irregular plural)", () => {
    const resolved = resolveServerCore({
      ...baseCore,
      displayName: "Batch",
      displayNamePlural: "Batches",
    });
    expect(resolved.displayNamePlural).toBe("Batches");
  });

  it("passes searchableFields through unchanged (undefined stays undefined)", () => {
    const resolved = resolveServerCore(baseCore);
    expect(resolved.searchableFields).toBeUndefined();
  });

  it("passes an explicit searchableFields through unchanged", () => {
    const resolved = resolveServerCore({
      ...baseCore,
      searchableFields: ["name"],
    });
    expect(resolved.searchableFields).toEqual(["name"]);
  });

  it("passes defaultSort through unchanged (undefined stays undefined)", () => {
    const resolved = resolveServerCore(baseCore);
    expect(resolved.defaultSort).toBeUndefined();
  });

  it("passes an explicit defaultSort through unchanged", () => {
    const resolved = resolveServerCore({
      ...baseCore,
      defaultSort: { column: "name", direction: "asc" },
    });
    expect(resolved.defaultSort).toEqual({ column: "name", direction: "asc" });
  });

  it("passes all other fields through unchanged", () => {
    const resolved = resolveServerCore({
      ...baseCore,
      viewTable: "widgets_with_extras",
      keyFields: ["name"],
      detailHeader: { title: "name", badge: "status" },
    });
    expect(resolved.viewTable).toBe("widgets_with_extras");
    expect(resolved.keyFields).toEqual(["name"]);
    expect(resolved.detailHeader).toEqual({ title: "name", badge: "status" });
    expect(resolved.table).toBe("widgets");
    expect(resolved.domain).toBe("production");
  });

  it("leaves a stateless entity's formSchema untouched (identity)", () => {
    const schema = z.object({ name: z.string() });
    const resolved = resolveServerCore({ ...baseCore, formSchema: schema });
    expect(resolved.formSchema).toBe(schema);
  });
});

// =============================================================================
// resolveServerCore — state-field schema guard (audit EA-9)
// =============================================================================

describe("resolveServerCore state-field guard", () => {
  const statefulCore: EntityCoreInput<Record<string, unknown>> = {
    name: "widget",
    table: "widgets",
    displayName: "Widget",
    domain: "production",
    // Deliberately a bare z.string() status — the pre-EA-9 shape several
    // cores still author; the guard must reject non-machine states anyway.
    formSchema: z.object({
      name: z.string().optional(),
      status: z.string().default("draft"),
    }),
    stateMachine: fullStateMachine,
  };

  it("rejects a status outside the state machine, on the status path", () => {
    const resolved = resolveServerCore(statefulCore);
    const result = resolved.formSchema.safeParse({ status: "bogus" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === "status")).toBe(true);
    }
  });

  it("accepts every machine state", () => {
    const resolved = resolveServerCore(statefulCore);
    for (const state of fullStateMachine.states) {
      expect(resolved.formSchema.safeParse({ status: state }).success).toBe(true);
    }
  });

  it("lets the base schema default apply when status is omitted", () => {
    const resolved = resolveServerCore(statefulCore);
    const result = resolved.formSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).status).toBe("draft");
    }
  });

  it("ignores payloads whose parse output omits the state field", () => {
    // Schemas without the state field (e.g. delivery) strip unknown keys, so
    // the guard sees no status and stays silent — the DB default rules there.
    const resolved = resolveServerCore({
      ...statefulCore,
      formSchema: z.object({ name: z.string().optional() }),
    });
    expect(resolved.formSchema.safeParse({ status: "bogus" }).success).toBe(true);
  });
});
