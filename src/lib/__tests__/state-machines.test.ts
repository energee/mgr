/**
 * State Machine Validation Tests
 *
 * Comprehensive tests for all entity state machine configurations.
 * Verifies structural integrity (all states have transitions, stateDisplay coverage,
 * valid transition targets) and specific transition paths for each entity.
 */

import { describe, it, expect, vi } from "vitest";
import type { StateMachineConfig } from "@/types/entity";

// Mock the Supabase client to prevent module-level createClient() calls
// that happen when entity configs import components (e.g., revision-history).
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

import { batchEntity } from "@/entities/batch";
import { orderEntity } from "@/entities/order";
import { purchaseOrderEntity } from "@/entities/purchase-order";
import { vesselEntity } from "@/entities/vessel";
import { packagingSessionEntity } from "@/entities/packaging-session";
import { allocationEntity } from "@/entities/allocation";
import { brewLogEntity } from "@/entities/brew-log";
import { pickListEntity } from "@/entities/pick-list";
import { recipeEntity } from "@/entities/recipe";
import { deliveryEntity } from "@/entities/delivery";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join, resolve } from "path";

// =============================================================================
// Test Helper
// =============================================================================

/**
 * Validates the structural integrity of a state machine configuration.
 * Checks that all states are accounted for in transitions and stateDisplay.
 */
function validateStateMachine(
  name: string,
  config: StateMachineConfig<Record<string, unknown>> | undefined
) {
  describe(`${name} state machine structure`, () => {
    it("has a defined state machine config", () => {
      expect(config).toBeDefined();
    });

    if (!config) return;

    it("has a non-empty states array", () => {
      expect(config.states.length).toBeGreaterThan(0);
    });

    it("has an initialState that exists in the states array", () => {
      expect(config.states).toContain(config.initialState);
    });

    it("has a transition entry for every state", () => {
      for (const state of config.states) {
        expect(config.transitions).toHaveProperty(state);
      }
    });

    it("has no transition entries for states not in the states array", () => {
      const transitionKeys = Object.keys(config.transitions);
      for (const key of transitionKeys) {
        expect(config.states).toContain(key);
      }
    });

    it("has all transition targets as valid states", () => {
      for (const [fromState, toStates] of Object.entries(config.transitions)) {
        for (const toState of toStates) {
          expect(
            config.states,
            `Transition ${fromState} -> ${toState}: "${toState}" is not a valid state`
          ).toContain(toState);
        }
      }
    });

    it("has stateDisplay covering all states", () => {
      expect(config.stateDisplay).toBeDefined();
      if (!config.stateDisplay) return;

      for (const state of config.states) {
        expect(
          config.stateDisplay,
          `Missing stateDisplay entry for "${state}"`
        ).toHaveProperty(state);
      }
    });

    it("has a label and color for every stateDisplay entry", () => {
      if (!config.stateDisplay) return;

      for (const [state, display] of Object.entries(config.stateDisplay)) {
        expect(display.label, `Missing label for state "${state}"`).toBeTruthy();
        expect(display.color, `Missing color for state "${state}"`).toBeTruthy();
      }
    });

    it("has no stateDisplay entries for states not in the states array", () => {
      if (!config.stateDisplay) return;

      const displayKeys = Object.keys(config.stateDisplay);
      for (const key of displayKeys) {
        expect(
          config.states,
          `stateDisplay has entry for "${key}" which is not a valid state`
        ).toContain(key);
      }
    });

    it("has no self-transitions (state cannot transition to itself)", () => {
      for (const [fromState, toStates] of Object.entries(config.transitions)) {
        expect(
          toStates,
          `State "${fromState}" has a self-transition`
        ).not.toContain(fromState);
      }
    });
  });
}

// =============================================================================
// Helper: Check if a transition path is valid
// =============================================================================

/**
 * Returns true if each consecutive pair in the path is a valid transition.
 */
function isValidPath(
  transitions: Record<string, string[]>,
  path: string[]
): boolean {
  for (let i = 0; i < path.length - 1; i++) {
    const from = path[i];
    const to = path[i + 1];
    const allowed = transitions[from];
    if (!allowed || !allowed.includes(to)) {
      return false;
    }
  }
  return true;
}

/**
 * Returns true if a direct transition from `from` to `to` is valid.
 */
function canTransition(
  transitions: Record<string, string[]>,
  from: string,
  to: string
): boolean {
  const allowed = transitions[from];
  return !!allowed && allowed.includes(to);
}

// =============================================================================
// Structural Validation for All Entities
// =============================================================================

describe("State Machine Validation", () => {
  // Cast to generic type for the helper function
  type GenericSM = StateMachineConfig<Record<string, unknown>>;

  validateStateMachine("batch", batchEntity.stateMachine as GenericSM);
  validateStateMachine("order", orderEntity.stateMachine as GenericSM);
  validateStateMachine("purchase_order", purchaseOrderEntity.stateMachine as GenericSM);
  validateStateMachine("vessel", vesselEntity.stateMachine as GenericSM);
  validateStateMachine("packaging_session", packagingSessionEntity.stateMachine as GenericSM);
  validateStateMachine("allocation", allocationEntity.stateMachine as GenericSM);

  // ===========================================================================
  // Batch: Specific Transition Path Tests
  // ===========================================================================

  describe("batch transition paths", () => {
    const transitions = batchEntity.stateMachine!.transitions;

    it("supports the full lifecycle: planned -> fermenting -> conditioning -> packaging -> completed", () => {
      expect(
        isValidPath(transitions, [
          "planned",
          "fermenting",
          "conditioning",
          "packaging",
          "completed",
        ])
      ).toBe(true);
    });

    it("does NOT allow a direct planned -> completed transition", () => {
      expect(canTransition(transitions, "planned", "completed")).toBe(false);
    });

    it("does NOT allow a direct planned -> packaging transition", () => {
      expect(canTransition(transitions, "planned", "packaging")).toBe(false);
    });

    it("does NOT allow transitions from terminal states (completed, cancelled, archived)", () => {
      expect(transitions["completed"]).toEqual([]);
      expect(transitions["cancelled"]).toEqual([]);
      expect(transitions["archived"]).toEqual([]);
    });

    it("has 'planned' as the initial state", () => {
      expect(batchEntity.stateMachine!.initialState).toBe("planned");
    });
  });

  // ===========================================================================
  // Order: Specific Transition Path Tests
  // ===========================================================================

  describe("order transition paths", () => {
    const transitions = orderEntity.stateMachine!.transitions;

    it("supports the full lifecycle: draft -> confirmed -> scheduled -> picking -> packed -> fulfilled", () => {
      expect(
        isValidPath(transitions, [
          "draft",
          "confirmed",
          "scheduled",
          "picking",
          "packed",
          "fulfilled",
        ])
      ).toBe(true);
    });

    it("does NOT allow a direct draft -> fulfilled transition", () => {
      expect(canTransition(transitions, "draft", "fulfilled")).toBe(false);
    });

    it("allows cancellation from draft through packed", () => {
      expect(canTransition(transitions, "draft", "cancelled")).toBe(true);
      expect(canTransition(transitions, "confirmed", "cancelled")).toBe(true);
      expect(canTransition(transitions, "scheduled", "cancelled")).toBe(true);
      expect(canTransition(transitions, "picking", "cancelled")).toBe(true);
      expect(canTransition(transitions, "packed", "cancelled")).toBe(true);
    });

    it("does NOT allow cancellation from fulfilled", () => {
      expect(canTransition(transitions, "fulfilled", "cancelled")).toBe(false);
    });

    it("has terminal states fulfilled and cancelled with no outbound transitions", () => {
      expect(transitions["fulfilled"]).toEqual([]);
      expect(transitions["cancelled"]).toEqual([]);
    });

    it("has 'draft' as the initial state", () => {
      expect(orderEntity.stateMachine!.initialState).toBe("draft");
    });
  });

  // ===========================================================================
  // Purchase Order: Specific Transition Path Tests
  // ===========================================================================

  describe("purchase order transition paths", () => {
    const transitions = purchaseOrderEntity.stateMachine!.transitions;

    it("supports the primary lifecycle: draft -> submitted -> confirmed -> fulfilled", () => {
      expect(
        isValidPath(transitions, [
          "draft",
          "submitted",
          "confirmed",
          "fulfilled",
        ])
      ).toBe(true);
    });

    it("supports the partial receipt path: confirmed -> partial -> fulfilled", () => {
      expect(
        isValidPath(transitions, ["confirmed", "partial", "fulfilled"])
      ).toBe(true);
    });

    it("supports closing after fulfillment: fulfilled -> closed", () => {
      expect(canTransition(transitions, "fulfilled", "closed")).toBe(true);
    });

    it("does NOT allow a direct draft -> fulfilled transition", () => {
      expect(canTransition(transitions, "draft", "fulfilled")).toBe(false);
    });

    it("allows cancellation from draft through partial", () => {
      expect(canTransition(transitions, "draft", "cancelled")).toBe(true);
      expect(canTransition(transitions, "submitted", "cancelled")).toBe(true);
      expect(canTransition(transitions, "confirmed", "cancelled")).toBe(true);
      expect(canTransition(transitions, "partial", "cancelled")).toBe(true);
    });

    it("does NOT allow cancellation from fulfilled or closed", () => {
      expect(canTransition(transitions, "fulfilled", "cancelled")).toBe(false);
      expect(canTransition(transitions, "closed", "cancelled")).toBe(false);
    });

    it("has terminal states cancelled and closed with no outbound transitions", () => {
      expect(transitions["cancelled"]).toEqual([]);
      expect(transitions["closed"]).toEqual([]);
    });

    it("has 'draft' as the initial state", () => {
      expect(purchaseOrderEntity.stateMachine!.initialState).toBe("draft");
    });
  });

  // ===========================================================================
  // Vessel: Specific Transition Path Tests
  // ===========================================================================

  describe("vessel transition paths", () => {
    const transitions = vesselEntity.stateMachine!.transitions;

    it("supports the cleaning cycle: ready_for_use -> in_use -> dirty -> caustic_cleaned -> ready_for_use", () => {
      expect(
        isValidPath(transitions, [
          "ready_for_use",
          "in_use",
          "dirty",
          "caustic_cleaned",
          "ready_for_use",
        ])
      ).toBe(true);
    });

    it("supports skipping caustic clean: dirty -> ready_for_use", () => {
      expect(canTransition(transitions, "dirty", "ready_for_use")).toBe(true);
    });

    it("allows any active state to enter maintenance", () => {
      expect(canTransition(transitions, "dirty", "maintenance")).toBe(true);
      expect(canTransition(transitions, "caustic_cleaned", "maintenance")).toBe(true);
      expect(canTransition(transitions, "ready_for_use", "maintenance")).toBe(true);
      expect(canTransition(transitions, "in_use", "maintenance")).toBe(true);
    });

    it("transitions from maintenance back to dirty", () => {
      expect(canTransition(transitions, "maintenance", "dirty")).toBe(true);
    });

    it("does NOT allow direct maintenance -> ready_for_use", () => {
      expect(canTransition(transitions, "maintenance", "ready_for_use")).toBe(false);
    });

    it("does NOT allow in_use -> ready_for_use (must go through dirty first)", () => {
      expect(canTransition(transitions, "in_use", "ready_for_use")).toBe(false);
    });

    it("has 'ready_for_use' as the initial state", () => {
      expect(vesselEntity.stateMachine!.initialState).toBe("ready_for_use");
    });
  });

  // ===========================================================================
  // Packaging Session: Specific Transition Path Tests
  // ===========================================================================

  describe("packaging session transition paths", () => {
    const transitions = packagingSessionEntity.stateMachine!.transitions;

    it("supports the standard lifecycle: planned -> in_progress -> completed", () => {
      expect(
        isValidPath(transitions, ["planned", "in_progress", "completed"])
      ).toBe(true);
    });

    it("supports revision after completion: completed -> revised", () => {
      expect(canTransition(transitions, "completed", "revised")).toBe(true);
    });

    it("allows cancellation from planned and in_progress", () => {
      expect(canTransition(transitions, "planned", "cancelled")).toBe(true);
      expect(canTransition(transitions, "in_progress", "cancelled")).toBe(true);
    });

    it("does NOT allow cancellation from completed or revised", () => {
      expect(canTransition(transitions, "completed", "cancelled")).toBe(false);
      expect(canTransition(transitions, "revised", "cancelled")).toBe(false);
    });

    it("has terminal states revised and cancelled with no outbound transitions", () => {
      expect(transitions["revised"]).toEqual([]);
      expect(transitions["cancelled"]).toEqual([]);
    });

    it("does NOT allow a direct planned -> completed transition", () => {
      expect(canTransition(transitions, "planned", "completed")).toBe(false);
    });

    it("has 'planned' as the initial state", () => {
      expect(packagingSessionEntity.stateMachine!.initialState).toBe("planned");
    });
  });

  // ===========================================================================
  // Allocation: Specific Transition Path Tests
  // ===========================================================================

  describe("allocation transition paths", () => {
    const transitions = allocationEntity.stateMachine!.transitions;

    it("supports direct completion: planned -> completed", () => {
      expect(canTransition(transitions, "planned", "completed")).toBe(true);
    });

    it("supports approval path: planned -> pending_approval -> completed", () => {
      expect(
        isValidPath(transitions, [
          "planned",
          "pending_approval",
          "completed",
        ])
      ).toBe(true);
    });

    it("supports rejection from pending_approval", () => {
      expect(canTransition(transitions, "pending_approval", "rejected")).toBe(true);
    });

    it("supports cancellation from planned", () => {
      expect(canTransition(transitions, "planned", "cancelled")).toBe(true);
    });

    it("does NOT allow cancellation from pending_approval", () => {
      expect(canTransition(transitions, "pending_approval", "cancelled")).toBe(false);
    });

    it("has terminal states completed, rejected, and cancelled with no outbound transitions", () => {
      expect(transitions["completed"]).toEqual([]);
      expect(transitions["rejected"]).toEqual([]);
      expect(transitions["cancelled"]).toEqual([]);
    });

    it("has 'planned' as the initial state", () => {
      expect(allocationEntity.stateMachine!.initialState).toBe("planned");
    });
  });

  // ===========================================================================
  // SQL / TypeScript State Machine Sync Verification
  // ===========================================================================

  describe("SQL and TypeScript state machine sync", () => {
    /**
     * `get_state_transitions()` is redefined by several migrations
     * (`CREATE OR REPLACE`), so only the LAST definition in migration order is
     * the one Postgres actually runs. Pinning this test to a single filename is
     * how it silently rots: an earlier revision of this suite read
     * `00143_server_side_state_machine.sql` and therefore kept passing while two
     * later migrations replaced the function underneath it.
     *
     * Migration filenames are zero-padded (`00XXX_*.sql`), so a lexicographic
     * sort is also the numeric apply order.
     */
    const MIGRATIONS_DIR = resolve(__dirname, "../../../supabase/migrations");

    /** Matches every `CREATE OR REPLACE FUNCTION get_state_transitions ... END; $$` body. */
    const FN_BODY_PATTERN =
      /CREATE OR REPLACE FUNCTION get_state_transitions[\s\S]*?BEGIN([\s\S]*?)END;\s*\$\$/g;

    /** Matches each `WHEN 'table_name' THEN '{...}'::JSONB` arm of the CASE. */
    const WHEN_PATTERN =
      /WHEN\s+'(\w+)'\s+THEN\s+'(\{[^}]*(?:\{[^}]*\}[^}]*)*\})'\s*::JSONB/g;

    type SqlDefinition = {
      /** Migration file the winning definition came from. */
      file: string;
      /** table_name -> (state -> allowed target states). */
      transitions: Record<string, Record<string, string[]>>;
    };

    /** Extracts the `WHEN ... THEN ...` transition maps out of one function body. */
    function parseWhenClauses(fnBody: string): Record<string, Record<string, string[]>> {
      const result: Record<string, Record<string, string[]>> = {};
      for (const match of fnBody.matchAll(WHEN_PATTERN)) {
        result[match[1]] = JSON.parse(match[2]);
      }
      return result;
    }

    /**
     * Scans every migration in apply order and returns the last (winning)
     * definition of `get_state_transitions()`, plus every file that defines it.
     */
    function findWinningDefinition(): { winner: SqlDefinition; definingFiles: string[] } {
      const files = readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith(".sql"))
        .sort();

      const definingFiles: string[] = [];
      let winner: SqlDefinition | null = null;

      for (const file of files) {
        const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
        const bodies = [...sql.matchAll(FN_BODY_PATTERN)];
        if (bodies.length === 0) continue;

        definingFiles.push(file);
        // Last definition within the file wins too.
        winner = { file, transitions: parseWhenClauses(bodies[bodies.length - 1][1]) };
      }

      if (!winner) {
        throw new Error(
          `No CREATE OR REPLACE FUNCTION get_state_transitions found in ${MIGRATIONS_DIR}`
        );
      }
      return { winner, definingFiles };
    }

    const { winner, definingFiles } = findWinningDefinition();
    const sqlTransitions = winner.transitions;

    /** Maps SQL table names to their TypeScript entity configs. */
    const tableToEntity: Record<string, { name: string; transitions: Record<string, string[]> }> = {
      batches: { name: "batchEntity", transitions: batchEntity.stateMachine!.transitions },
      orders: { name: "orderEntity", transitions: orderEntity.stateMachine!.transitions },
      purchase_orders: { name: "purchaseOrderEntity", transitions: purchaseOrderEntity.stateMachine!.transitions },
      packaging_sessions: { name: "packagingSessionEntity", transitions: packagingSessionEntity.stateMachine!.transitions },
      brew_logs: { name: "brewLogEntity", transitions: brewLogEntity.stateMachine!.transitions },
      allocations: { name: "allocationEntity", transitions: allocationEntity.stateMachine!.transitions },
      pick_lists: { name: "pickListEntity", transitions: pickListEntity.stateMachine!.transitions },
      recipes: { name: "recipeEntity", transitions: recipeEntity.stateMachine!.transitions },
      deliveries: { name: "deliveryEntity", transitions: deliveryEntity.stateMachine!.transitions },
    };

    /**
     * Stateful entities deliberately NOT enforced in the database: they have a
     * `stateMachine` in TypeScript but no arm in `get_state_transitions()`.
     * Listed explicitly so that adding a new stateful entity forces a conscious
     * decision about server-side enforcement instead of silently defaulting to
     * "client-only".
     */
    const TS_ONLY_STATEFUL_ENTITIES = [
      "location-transfer",
      "user-profile",
      "vessel",
      "yeast-pitch",
    ];

    it("resolves the winning get_state_transitions() definition, not a stale one", () => {
      // Guards the exact defect this suite used to have: reading the FIRST
      // definition instead of the last one that actually applies.
      expect(definingFiles.length).toBeGreaterThan(1);
      expect(winner.file).toBe(definingFiles[definingFiles.length - 1]);
      expect(Object.keys(sqlTransitions).length).toBeGreaterThan(0);
    });

    it("SQL contains transition maps for all expected tables", () => {
      for (const table of Object.keys(tableToEntity)) {
        expect(
          sqlTransitions,
          `SQL (${winner.file}) is missing a transition map for table "${table}"`
        ).toHaveProperty(table);
      }
    });

    it("every table in SQL is mapped to a TypeScript entity", () => {
      for (const table of Object.keys(sqlTransitions)) {
        expect(
          Object.keys(tableToEntity),
          `SQL (${winner.file}) defines transitions for "${table}" but no TypeScript entity is mapped to it`
        ).toContain(table);
      }
    });

    it("every stateful entity is either DB-enforced or explicitly TS-only", () => {
      const dbEnforced = Object.values(tableToEntity).map((e) => e.name);
      const entitiesDir = resolve(__dirname, "../../entities");
      const stateful = readdirSync(entitiesDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .filter((name) => {
          // Every entity directory carries a core.ts (AGENTS.md constraint 15);
          // skip support dirs like __tests__ that don't.
          const corePath = join(entitiesDir, name, "core.ts");
          if (!existsSync(corePath)) return false;
          return readFileSync(corePath, "utf-8").includes("stateMachine:");
        });

      for (const dir of stateful) {
        // e.g. "purchase-order" -> "purchaseOrderEntity"
        const entityName =
          dir.replace(/-(\w)/g, (_, c: string) => c.toUpperCase()) + "Entity";
        if (dbEnforced.includes(entityName)) continue;
        expect(
          TS_ONLY_STATEFUL_ENTITIES,
          `Entity "${dir}" has a stateMachine but is neither mapped to a SQL table nor listed in TS_ONLY_STATEFUL_ENTITIES. Decide whether it needs server-side enforcement.`
        ).toContain(dir);
      }
    });

    type TransitionMap = Record<string, string[]>;

    /**
     * Returns a human-readable discrepancy for every state whose allowed target
     * set differs between the SQL map and the TypeScript map. Empty array means
     * the two sides agree exactly.
     */
    function diffTransitionMaps(sqlMap: TransitionMap, tsMap: TransitionMap): string[] {
      const problems: string[] = [];
      for (const state of new Set([...Object.keys(sqlMap), ...Object.keys(tsMap)])) {
        const inSql = state in sqlMap;
        const inTs = state in tsMap;
        if (!inTs) {
          problems.push(`state "${state}" exists in SQL but not in TypeScript`);
          continue;
        }
        if (!inSql) {
          problems.push(`state "${state}" exists in TypeScript but not in SQL`);
          continue;
        }
        const sqlTargets = [...sqlMap[state]].sort();
        const tsTargets = [...tsMap[state]].sort();
        if (JSON.stringify(sqlTargets) !== JSON.stringify(tsTargets)) {
          problems.push(
            `state "${state}": SQL allows [${sqlTargets}] but TypeScript allows [${tsTargets}]`
          );
        }
      }
      return problems.sort();
    }

    it("diffTransitionMaps detects the kind of drift that caused the 'revised' outage", () => {
      // Self-check: the comparison must actually have teeth. A state that exists
      // on one side only, and a target list that differs, both have to surface.
      const sql = { completed: ["revised"], revised: [], cancelled: [] };
      const tsDropped = { completed: [], cancelled: [] };
      expect(diffTransitionMaps(sql, tsDropped)).toEqual([
        'state "completed": SQL allows [revised] but TypeScript allows []',
        'state "revised" exists in SQL but not in TypeScript',
      ]);
      // …and an exact match must produce no noise.
      expect(diffTransitionMaps(sql, { ...sql })).toEqual([]);
    });

    for (const [tableName, entity] of Object.entries(tableToEntity)) {
      describe(`${tableName}`, () => {
        const sqlMap = sqlTransitions[tableName];
        const tsMap = entity.transitions;

        if (!sqlMap) {
          it(`has a SQL transition map in ${winner.file}`, () => {
            throw new Error(
              `No SQL transitions found for "${tableName}" in ${winner.file}; ` +
                `${entity.name} would be unenforced at the database level.`
            );
          });
          return;
        }

        it("agrees with the TypeScript config on states and transitions", () => {
          expect(
            diffTransitionMaps(sqlMap, tsMap),
            `${entity.name}.stateMachine.transitions drifted from ${winner.file} (table "${tableName}")`
          ).toEqual([]);
        });

        it("every SQL state exists in the TypeScript config", () => {
          const sqlStates = Object.keys(sqlMap);
          const tsStates = Object.keys(tsMap);
          for (const state of sqlStates) {
            expect(
              tsStates,
              `State "${state}" is in SQL (${tableName}) but missing from ${entity.name}.stateMachine.transitions`
            ).toContain(state);
          }
        });

        it("every TypeScript state exists in the SQL map", () => {
          const sqlStates = Object.keys(sqlMap);
          const tsStates = Object.keys(tsMap);
          for (const state of tsStates) {
            expect(
              sqlStates,
              `State "${state}" is in ${entity.name}.stateMachine.transitions but missing from SQL (${tableName})`
            ).toContain(state);
          }
        });

        it("allowed transitions match exactly for every state", () => {
          const allStates = new Set([...Object.keys(sqlMap), ...Object.keys(tsMap)]);
          for (const state of allStates) {
            const sqlTargets = [...(sqlMap[state] ?? [])].sort();
            const tsTargets = [...(tsMap[state] ?? [])].sort();
            expect(tsTargets).toEqual(sqlTargets);
          }
        });
      });
    }
  });
});
