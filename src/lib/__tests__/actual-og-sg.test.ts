/**
 * actual_og Plato -> SG conversion regression tests (audit 2026-07-06, H3)
 *
 * Brew-log gravity is measured in Plato, but the `actual_og` contract is SG
 * (src/domain/units.ts, formatGravityFromSg docblock). Migration 00204 makes
 * the batches_with_brew_info VIEW the single conversion point (and fixes
 * analyze_batch_performance the same way); no TypeScript consumer converts.
 * These structural tests pin that conversion in the latest SQL definitions,
 * and pin the SQL formula's equivalence to platoToSg() so the two can never
 * drift apart silently.
 */
import { describe, it, expect } from "vitest";
import { platoToSg } from "@/domain/units";
import { latestFunctionBody, latestViewBody } from "./sql-def-helpers";

/**
 * The exact Plato->SG denominator used by platoToSg():
 *   SG = 1 + Plato / (258.6 - 0.8796 * Plato)
 */
const PLATO_TO_SG_EXPR = /1 \+ (\w+\.\w+) \/ \(258\.6 - 0\.8796 \* \1\)/;

describe("batches_with_brew_info.actual_og", () => {
  const body = latestViewBody("batches_with_brew_info");

  it("is defined in a migration", () => {
    expect(body).not.toBeNull();
  });

  it("averages the Plato knockout measurements, then converts to SG", () => {
    // Still sources the Plato gravity metric (weight-averaged in the
    // measured unit)...
    expect(body!).toMatch(/m->>'metric' = 'gravity_plato'/);
    // ...and converts the average with the platoToSg() formula.
    expect(body!).toMatch(PLATO_TO_SG_EXPR);
  });
});

describe("analyze_batch_performance actuals.og", () => {
  const body = latestFunctionBody("analyze_batch_performance");

  it("extracts the gravity metric specifically (not measurements[0])", () => {
    const ogBlock = body!.slice(body!.indexOf("'og'"), body!.indexOf("'fg'"));
    expect(ogBlock).toMatch(/m->>'metric' = 'gravity_plato'/);
  });

  it("converts the Plato measurement to SG", () => {
    const ogBlock = body!.slice(body!.indexOf("'og'"), body!.indexOf("'fg'"));
    expect(ogBlock).toMatch(PLATO_TO_SG_EXPR);
  });
});

describe("SQL formula equivalence with platoToSg()", () => {
  it("1 + P / (258.6 - 0.8796 * P) matches src/domain/units.ts platoToSg", () => {
    // The SQL in 00204 quotes platoToSg()'s formula exactly; verify the
    // quoted constants reproduce the TS function across the brewing range.
    const sqlFormula = (plato: number) => 1 + plato / (258.6 - 0.8796 * plato);
    for (const plato of [0, 8.0, 12.5, 17.5, 25.0]) {
      expect(sqlFormula(plato)).toBeCloseTo(platoToSg(plato), 12);
    }
    // Spot-check the scale: 12.5degP is ~1.0505 SG, NOT 12.5 (the pre-00204
    // bug shipped raw Plato to SG consumers).
    expect(sqlFormula(12.5)).toBeGreaterThan(1.04);
    expect(sqlFormula(12.5)).toBeLessThan(1.06);
  });
});
