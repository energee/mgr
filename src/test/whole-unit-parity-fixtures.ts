/**
 * Shared whole-unit BOM ceiling fixtures (issues #616 / migration 00217).
 *
 * `quantity_per_unit` is stored as `DECIMAL(10,4)`, so a "1 per 24" BOM line
 * persists as `0.0417` — strictly greater than 1/24. Multiplying that decimal
 * by the unit count overshoots the integer boundary, and ceiling the product
 * books an extra whole unit (`ceil(240 * 0.0417) = 11` against a true 10).
 * Every implementation of the rule must therefore recover the exact integer
 * ratio behind the stored decimal BEFORE ceiling.
 *
 * There are four such implementations, and they must agree exactly:
 * - `computeBomConsumption` (src/domain/consumption-planning.ts) — the TS
 *   reference for the actual-quantity depletion path,
 * - `computeSessionMaterialRequirements` (src/domain/material-planning.ts) —
 *   the planned-quantity preview the operator approves. Deliberately not
 *   merged with the above (different zero-row, grouping and return
 *   semantics); this table is what stops the shared ratio/ceiling rule
 *   drifting between them,
 * - `whole_unit_material_qty()` (migration 00217) — used by the revise RPC,
 * - `exact_material_qty()` (migration 00279) — the non-ceiling core shared by
 *   the above and by `transition_entity_atomic`'s completion depletion.
 *
 * This table is the single source of truth those parity assertions read, so a
 * formula change on one side cannot quietly diverge from the others:
 * - src/domain/__tests__/consumption-planning.test.ts (TS, depletion)
 * - src/domain/__tests__/material-planning.test.ts (TS, planned preview)
 * - src/__tests__/integration/packaging-material-consumption.test.ts (SQL side)
 */

/** `[quantity_per_unit, units, expected whole-unit consumption]`. */
export type WholeUnitCase = [qpu: number, units: number, expected: number];

/**
 * Ratios that round UP when truncated to four decimals (1/24, 1/6) are the
 * over-draw cases; exact decimals (0.25, 2.0, 1.0) pin that ratio recovery
 * does not perturb the easy cases.
 */
export const WHOLE_UNIT_PARITY_CASES: WholeUnitCase[] = [
  [0.0417, 24, 1],
  [0.0417, 25, 2],
  [0.0417, 30, 2],
  [0.0417, 48, 2],
  [0.0417, 240, 10],
  [0.1667, 6, 1],
  [0.1429, 7, 1],
  [0.25, 10, 3],
  [2.0, 5, 10],
  [1.0, 7, 7],
];
