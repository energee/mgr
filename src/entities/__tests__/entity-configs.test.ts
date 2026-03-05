/**
 * Entity Configuration Structural Validation Tests
 *
 * Validates that all registered entity configurations are structurally correct.
 * Catches misconfigurations (missing fields, invalid state machine references,
 * duplicate names, etc.) at test time rather than runtime.
 */

import { describe, it, expect, beforeAll, vi } from "vitest";
import type { EntityConfig } from "@/types/entity";

// Mock the Supabase client to avoid env var requirements during import.
// Several entity configs transitively import components that call createClient()
// at module scope (e.g., revision-history.tsx).
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

// =============================================================================
// Collect all registered entities for parameterized testing
// =============================================================================

let allEntities: EntityConfig<Record<string, unknown>>[] = [];

beforeAll(() => {
  allEntities = Array.from(entityRegistry.values());
  // Sanity check: make sure we actually loaded entities
  expect(allEntities.length).toBeGreaterThan(0);
});

// =============================================================================
// Required Fields
// =============================================================================

describe("Entity configs: required fields", () => {
  it("every entity has required identity fields", () => {
    for (const entity of Array.from(entityRegistry.values())) {
      expect(entity.name, `Entity missing 'name'`).toBeTruthy();
      expect(typeof entity.name).toBe("string");

      expect(entity.table, `${entity.name}: missing 'table'`).toBeTruthy();
      expect(typeof entity.table).toBe("string");

      expect(
        entity.displayName,
        `${entity.name}: missing 'displayName'`
      ).toBeTruthy();
      expect(typeof entity.displayName).toBe("string");

      expect(
        entity.displayNamePlural,
        `${entity.name}: missing 'displayNamePlural'`
      ).toBeTruthy();
      expect(typeof entity.displayNamePlural).toBe("string");

      expect(entity.domain, `${entity.name}: missing 'domain'`).toBeTruthy();
      expect(typeof entity.domain).toBe("string");
    }
  });

  it("every entity has a valid domain value", () => {
    const validDomains = [
      "system",
      "production",
      "packaging",
      "inventory",
      "purchasing",
      "sales",
      "reporting",
    ];
    for (const entity of Array.from(entityRegistry.values())) {
      expect(
        validDomains,
        `${entity.name}: invalid domain '${entity.domain}'`
      ).toContain(entity.domain);
    }
  });
});

// =============================================================================
// No Duplicate Entity Names
// =============================================================================

describe("Entity configs: uniqueness", () => {
  it("no duplicate entity names across all configs", () => {
    const names = Array.from(entityRegistry.values()).map((e) => e.name);
    const seen = new Set<string>();
    const duplicates: string[] = [];

    for (const name of names) {
      if (seen.has(name)) {
        duplicates.push(name);
      }
      seen.add(name);
    }

    expect(
      duplicates,
      `Duplicate entity names found: ${duplicates.join(", ")}`
    ).toEqual([]);
  });
});

// =============================================================================
// List Columns
// =============================================================================

describe("Entity configs: listColumns", () => {
  it("every entity has a non-empty listColumns array", () => {
    for (const entity of Array.from(entityRegistry.values())) {
      expect(
        Array.isArray(entity.listColumns),
        `${entity.name}: 'listColumns' must be an array`
      ).toBe(true);
      expect(
        entity.listColumns.length,
        `${entity.name}: 'listColumns' must not be empty`
      ).toBeGreaterThan(0);
    }
  });

  it("every entity with listColumns has at least one column with a header", () => {
    for (const entity of Array.from(entityRegistry.values())) {
      if (entity.listColumns && entity.listColumns.length > 0) {
        const columnsWithHeaders = entity.listColumns.filter(
          (col) => col.header != null && col.header !== ""
        );
        expect(
          columnsWithHeaders.length,
          `${entity.name}: has listColumns but none have a header`
        ).toBeGreaterThan(0);
      }
    }
  });
});

// =============================================================================
// Form Schema (Zod)
// =============================================================================

describe("Entity configs: formSchema", () => {
  it("every entity has a formSchema defined", () => {
    for (const entity of Array.from(entityRegistry.values())) {
      expect(
        entity.formSchema,
        `${entity.name}: missing 'formSchema'`
      ).toBeTruthy();
    }
  });

  it("every entity formSchema is a valid Zod schema (has parse and safeParse methods)", () => {
    for (const entity of Array.from(entityRegistry.values())) {
      if (entity.formSchema) {
        expect(
          typeof entity.formSchema.parse,
          `${entity.name}: formSchema is not a valid Zod schema (missing 'parse')`
        ).toBe("function");
        expect(
          typeof entity.formSchema.safeParse,
          `${entity.name}: formSchema is not a valid Zod schema (missing 'safeParse')`
        ).toBe("function");
      }
    }
  });
});

// =============================================================================
// State Machine
// =============================================================================

describe("Entity configs: stateMachine", () => {
  it("every entity with a stateMachine has required properties", () => {
    for (const entity of Array.from(entityRegistry.values())) {
      if (!entity.stateMachine) continue;

      const sm = entity.stateMachine;
      const prefix = `${entity.name}.stateMachine`;

      // stateField must be a non-empty string
      expect(
        sm.stateField,
        `${prefix}: missing 'stateField'`
      ).toBeTruthy();
      expect(typeof sm.stateField).toBe("string");

      // states must be a non-empty array
      expect(
        Array.isArray(sm.states),
        `${prefix}: 'states' must be an array`
      ).toBe(true);
      expect(
        sm.states.length,
        `${prefix}: 'states' must not be empty`
      ).toBeGreaterThan(0);

      // transitions must be a non-empty object
      expect(
        sm.transitions,
        `${prefix}: missing 'transitions'`
      ).toBeTruthy();
      expect(
        typeof sm.transitions,
        `${prefix}: 'transitions' must be an object`
      ).toBe("object");
      expect(
        Object.keys(sm.transitions).length,
        `${prefix}: 'transitions' must not be empty`
      ).toBeGreaterThan(0);

      // stateDisplay should exist when stateMachine is defined
      if (sm.stateDisplay) {
        expect(
          typeof sm.stateDisplay,
          `${prefix}: 'stateDisplay' must be an object`
        ).toBe("object");
      }
    }
  });

  it("every state machine transition references valid states", () => {
    for (const entity of Array.from(entityRegistry.values())) {
      if (!entity.stateMachine) continue;

      const sm = entity.stateMachine;
      const validStates = new Set(sm.states);
      const prefix = `${entity.name}.stateMachine`;

      // Every 'from' state in transitions must be a valid state
      for (const fromState of Object.keys(sm.transitions)) {
        expect(
          validStates.has(fromState),
          `${prefix}: transition 'from' state '${fromState}' is not in states [${sm.states.join(", ")}]`
        ).toBe(true);

        // Every 'to' state must also be a valid state
        const toStates = sm.transitions[fromState];
        expect(
          Array.isArray(toStates),
          `${prefix}: transitions['${fromState}'] must be an array`
        ).toBe(true);

        for (const toState of toStates) {
          expect(
            validStates.has(toState),
            `${prefix}: transition target '${toState}' (from '${fromState}') is not in states [${sm.states.join(", ")}]`
          ).toBe(true);
        }
      }
    }
  });

  it("every stateDisplay key references a valid state", () => {
    for (const entity of Array.from(entityRegistry.values())) {
      if (!entity.stateMachine?.stateDisplay) continue;

      const sm = entity.stateMachine;
      const validStates = new Set(sm.states);
      const prefix = `${entity.name}.stateMachine.stateDisplay`;

      for (const displayState of Object.keys(sm.stateDisplay!)) {
        expect(
          validStates.has(displayState),
          `${prefix}: display key '${displayState}' is not in states [${sm.states.join(", ")}]`
        ).toBe(true);
      }
    }
  });

  it("every stateDisplay entry has a label and valid color", () => {
    const validColors = ["default", "success", "warning", "error", "info"];

    for (const entity of Array.from(entityRegistry.values())) {
      if (!entity.stateMachine?.stateDisplay) continue;

      const prefix = `${entity.name}.stateMachine.stateDisplay`;

      for (const [state, display] of Object.entries(
        entity.stateMachine.stateDisplay!
      )) {
        expect(
          display.label,
          `${prefix}['${state}']: missing 'label'`
        ).toBeTruthy();
        expect(
          validColors,
          `${prefix}['${state}']: invalid color '${display.color}'`
        ).toContain(display.color);
      }
    }
  });

  it("initialState is a valid state", () => {
    for (const entity of Array.from(entityRegistry.values())) {
      if (!entity.stateMachine) continue;

      const sm = entity.stateMachine;
      const validStates = new Set(sm.states);

      expect(
        validStates.has(sm.initialState),
        `${entity.name}.stateMachine: initialState '${sm.initialState}' is not in states [${sm.states.join(", ")}]`
      ).toBe(true);
    }
  });
});

// =============================================================================
// Sections (Unified)
// =============================================================================

describe("Entity configs: sections", () => {
  it("every entity with sections has at least one section", () => {
    for (const entity of Array.from(entityRegistry.values())) {
      if (entity.sections) {
        expect(
          entity.sections.length,
          `${entity.name}: 'sections' array is empty`
        ).toBeGreaterThan(0);
      }
    }
  });

  it("every section has an id and title", () => {
    for (const entity of Array.from(entityRegistry.values())) {
      if (!entity.sections) continue;

      for (const section of entity.sections) {
        expect(
          section.id,
          `${entity.name}: section missing 'id'`
        ).toBeTruthy();
        expect(
          section.title,
          `${entity.name}.sections['${section.id}']: missing 'title'`
        ).toBeTruthy();
      }
    }
  });

  it("every section with fields (no custom component) has at least one field", () => {
    for (const entity of Array.from(entityRegistry.values())) {
      if (!entity.sections) continue;

      for (const section of entity.sections) {
        // Sections with a custom component don't need fields
        if (section.component || section.editComponent) continue;

        // If fields array exists, it should have at least one field
        if (section.fields) {
          expect(
            section.fields.length,
            `${entity.name}.sections['${section.id}']: 'fields' array is empty`
          ).toBeGreaterThan(0);
        }
      }
    }
  });

  it("section ids are unique within each entity", () => {
    for (const entity of Array.from(entityRegistry.values())) {
      if (!entity.sections) continue;

      const ids = entity.sections.map((s) => s.id);
      const uniqueIds = new Set(ids);

      expect(
        uniqueIds.size,
        `${entity.name}: duplicate section ids found: ${ids.filter((id, i) => ids.indexOf(id) !== i).join(", ")}`
      ).toBe(ids.length);
    }
  });

  it("every section field has a name and label", () => {
    for (const entity of Array.from(entityRegistry.values())) {
      if (!entity.sections) continue;

      for (const section of entity.sections) {
        if (!section.fields) continue;

        for (const field of section.fields) {
          const prefix = `${entity.name}.sections['${section.id}']`;

          expect(
            field.name,
            `${prefix}: field missing 'name'`
          ).toBeTruthy();

          expect(
            field.label,
            `${prefix}.fields['${field.name}']: missing 'label'`
          ).toBeTruthy();
        }
      }
    }
  });
});

// =============================================================================
// Relations
// =============================================================================

describe("Entity configs: relations", () => {
  it("every relation has required fields (name, entity, type, foreignKey)", () => {
    const validRelationTypes = [
      "belongsTo",
      "hasMany",
      "hasOne",
      "manyToMany",
      "hasManyThrough",
    ];

    for (const entity of Array.from(entityRegistry.values())) {
      if (!entity.relations || entity.relations.length === 0) continue;

      for (const relation of entity.relations) {
        const prefix = `${entity.name}.relations['${relation.name}']`;

        expect(
          relation.name,
          `${entity.name}: relation missing 'name'`
        ).toBeTruthy();

        expect(
          relation.entity,
          `${prefix}: missing 'entity'`
        ).toBeTruthy();

        expect(
          validRelationTypes,
          `${prefix}: invalid type '${relation.type}'`
        ).toContain(relation.type);

        expect(
          relation.foreignKey,
          `${prefix}: missing 'foreignKey'`
        ).toBeTruthy();
      }
    }
  });

  it("hasManyThrough relations have a 'through' junction table", () => {
    for (const entity of Array.from(entityRegistry.values())) {
      if (!entity.relations) continue;

      for (const relation of entity.relations) {
        if (relation.type === "hasManyThrough") {
          expect(
            relation.through,
            `${entity.name}.relations['${relation.name}']: hasManyThrough relation missing 'through' junction table`
          ).toBeTruthy();
        }
      }
    }
  });

  it("relation names are unique within each entity", () => {
    for (const entity of Array.from(entityRegistry.values())) {
      if (!entity.relations || entity.relations.length === 0) continue;

      const names = entity.relations.map((r) => r.name);
      const uniqueNames = new Set(names);

      expect(
        uniqueNames.size,
        `${entity.name}: duplicate relation names: ${names.filter((n, i) => names.indexOf(n) !== i).join(", ")}`
      ).toBe(names.length);
    }
  });
});

// =============================================================================
// Actions
// =============================================================================

describe("Entity configs: actions", () => {
  it("every action has required fields (name, label, type)", () => {
    const validActionTypes = ["button", "dropdown"];

    for (const entity of Array.from(entityRegistry.values())) {
      if (!entity.actions || entity.actions.length === 0) continue;

      for (const action of entity.actions) {
        const prefix = `${entity.name}.actions['${action.name}']`;

        expect(
          action.name,
          `${entity.name}: action missing 'name'`
        ).toBeTruthy();

        expect(
          action.label,
          `${prefix}: missing 'label'`
        ).toBeTruthy();

        expect(
          validActionTypes,
          `${prefix}: invalid type '${action.type}'`
        ).toContain(action.type);
      }
    }
  });

  it("action fromStates reference valid state machine states", () => {
    for (const entity of Array.from(entityRegistry.values())) {
      if (!entity.actions || !entity.stateMachine) continue;

      const validStates = new Set(entity.stateMachine.states);

      for (const action of entity.actions) {
        if (!action.fromStates) continue;

        for (const state of action.fromStates) {
          expect(
            validStates.has(state),
            `${entity.name}.actions['${action.name}']: fromState '${state}' is not a valid state [${entity.stateMachine.states.join(", ")}]`
          ).toBe(true);
        }
      }
    }
  });

  it("action toState references a valid state machine state", () => {
    for (const entity of Array.from(entityRegistry.values())) {
      if (!entity.actions || !entity.stateMachine) continue;

      const validStates = new Set(entity.stateMachine.states);

      for (const action of entity.actions) {
        if (!action.toState) continue;

        expect(
          validStates.has(action.toState),
          `${entity.name}.actions['${action.name}']: toState '${action.toState}' is not a valid state [${entity.stateMachine.states.join(", ")}]`
        ).toBe(true);
      }
    }
  });
});

// =============================================================================
// Value Display
// =============================================================================

describe("Entity configs: valueDisplay", () => {
  it("every valueDisplay entry has a field and non-empty display object", () => {
    const validColors = ["default", "success", "warning", "error", "info"];

    for (const entity of Array.from(entityRegistry.values())) {
      if (!entity.valueDisplay) continue;

      for (const vd of entity.valueDisplay) {
        const prefix = `${entity.name}.valueDisplay['${vd.field}']`;

        expect(vd.field, `${entity.name}: valueDisplay missing 'field'`).toBeTruthy();

        expect(
          typeof vd.display,
          `${prefix}: 'display' must be an object`
        ).toBe("object");

        expect(
          Object.keys(vd.display).length,
          `${prefix}: 'display' must not be empty`
        ).toBeGreaterThan(0);

        // Validate each display entry
        for (const [value, config] of Object.entries(vd.display)) {
          expect(
            config.label,
            `${prefix}.display['${value}']: missing 'label'`
          ).toBeTruthy();

          if (config.color) {
            expect(
              validColors,
              `${prefix}.display['${value}']: invalid color '${config.color}'`
            ).toContain(config.color);
          }
        }
      }
    }
  });
});

// =============================================================================
// Searchable Fields
// =============================================================================

describe("Entity configs: searchableFields", () => {
  it("searchableFields is an array of non-empty strings when present", () => {
    for (const entity of Array.from(entityRegistry.values())) {
      if (!entity.searchableFields) continue;

      expect(
        Array.isArray(entity.searchableFields),
        `${entity.name}: 'searchableFields' must be an array`
      ).toBe(true);

      for (const field of entity.searchableFields) {
        expect(
          typeof field,
          `${entity.name}: searchableFields entry must be a string, got ${typeof field}`
        ).toBe("string");

        expect(
          field.length,
          `${entity.name}: searchableFields contains an empty string`
        ).toBeGreaterThan(0);
      }
    }
  });
});

// =============================================================================
// Cross-cutting: entity count sanity check
// =============================================================================

describe("Entity registry completeness", () => {
  it("has a reasonable number of registered entities (guards against silent registration failures)", () => {
    const count = entityRegistry.size;
    // We know there are ~37 entities from the index file; allow some wiggle room
    expect(count).toBeGreaterThanOrEqual(30);
  });

  it("every entity name matches its registry key", () => {
    for (const [key, entity] of entityRegistry.entries()) {
      expect(
        entity.name,
        `Registry key '${key}' does not match entity.name '${entity.name}'`
      ).toBe(key);
    }
  });
});
