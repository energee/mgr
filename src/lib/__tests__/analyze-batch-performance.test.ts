/**
 * analyze_batch_performance() SQL regression tests
 *
 * Guards the fermentation block of the AI helper function
 * `analyze_batch_performance(p_batch_id)`. Migration 00167 hardcoded
 * `readings_count -> 0` and `latest_reading -> NULL`, so the AI batch-analysis
 * tool always reported zero fermentation readings even when measurements exist
 * in `batch_logs` (log_type = 'measurement'). This test fails if that hardcoded
 * stub is ever reintroduced.
 *
 * Mirrors the migration-reading pattern in state-machines.test.ts: it parses the
 * *latest* migration that defines the function (highest-numbered wins, matching
 * Postgres apply order) and asserts on the function body's text.
 *
 * Ceiling: this is a structural SQL assertion, not a live-DB behavioral test —
 * the repo has no pgTAP/integration harness and no local Postgres. Upgrade to a
 * DB-backed test if one is ever introduced.
 */
import { describe, it, expect } from "vitest";
import { latestFunctionBody } from "./sql-def-helpers";

describe("analyze_batch_performance fermentation block", () => {
  const body = latestFunctionBody("analyze_batch_performance");

  it("defines analyze_batch_performance in a migration", () => {
    expect(body).not.toBeNull();
  });

  it("does not hardcode readings_count to 0", () => {
    expect(body!).not.toMatch(/'readings_count',\s*0\b/);
  });

  it("does not hardcode latest_reading to NULL", () => {
    expect(body!).not.toMatch(/'latest_reading',\s*NULL/i);
  });

  it("derives readings from batch_logs measurement rows", () => {
    const fermentation = body!.slice(body!.indexOf("'fermentation'"));
    expect(fermentation).toMatch(/batch_logs/);
    expect(fermentation).toMatch(/log_type\s*=\s*'measurement'/);
  });
});
