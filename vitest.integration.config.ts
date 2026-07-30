/**
 * Vitest config for integration tests.
 *
 * Separate from the unit-test config (vitest.config.ts) because:
 * - Integration tests run in `node` environment (not jsdom — no DOM needed,
 *   and Supabase JS client works fine in node).
 * - Longer per-test timeout (15 s) for real Postgres round-trips.
 * - Different include glob (only `src/__tests__/integration/**`).
 * - No coverage thresholds — integration tests supplement, not replace, unit coverage.
 *
 * Env vars required (set by CI; for local runs use .env.test.local or supabase start):
 *   SUPABASE_URL          — local Supabase API URL (e.g. http://127.0.0.1:54321)
 *   SUPABASE_ANON_KEY     — local anon key from `supabase status`
 *
 * Optional overrides (take precedence over the above):
 *   INTEGRATION_SUPABASE_URL
 *   INTEGRATION_SUPABASE_ANON_KEY
 */

import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    testTimeout: 15_000,
    include: ["src/__tests__/integration/**/*.test.ts"],
    // No setupFiles — integration tests don't need jsdom or React testing-library setup.
    //
    // One suite file at a time. Unit tests are isolated by module registry, but
    // every file here shares ONE database, so running them concurrently makes
    // them contend for real locks:
    //  - generate_next_number (batch codes, lot numbers) takes
    //    pg_advisory_xact_lock on a hash of table.column.prefix and holds it
    //    for the rest of the transaction, so any two suites packaging on the
    //    same day serialize on it — and, combined with the row locks each
    //    already holds, can deadlock. A deadlock victim surfaces as
    //    'deadlock detected' where the test expected its own injected error.
    //  - several suites (square-atomic-ingestion, atomic-yeast-pitch,
    //    inventory-guard-concurrency) deliberately COMMIT, so their rows are
    //    visible to any other suite's aggregate read while they run.
    //
    // Measured 2026-07-30 against a from-scratch replay of the chain, machine
    // otherwise idle, 30 files / 202 tests: parallel, 5 of 5 full runs failed
    // (3, 2, 3, 2 and 4 tests, every one of them `deadlock detected` surfacing
    // where the test expected its own injected error, in six different files);
    // serialized, 8 of 8 full runs clean.
    //
    // Be precise about what this does NOT fix. It serializes FILES within one
    // run; it does not serialize the several connections a single file opens
    // (inventory-guard-concurrency.test.ts deliberately runs two), and it has
    // no effect on anything outside the run — a second agent's session, a dev
    // server, another checkout — touching the same database. An adversarial
    // re-run of this suite on a loaded machine still hit a 15s test timeout in
    // 3 of 16 serialized runs, and captured pg_stat_activity showing a backend
    // blocked on the generate_next_number advisory lock with fileParallelism
    // already false. That residue is why every suite here that takes a
    // table-level lock opens its transaction through a `beginBounded` helper
    // with lock_timeout/statement_timeout set under this testTimeout: the
    // failure then names the statement that could not get its lock instead of
    // expiring as an opaque `Test timed out in 15000ms`.
    //
    // Wall clock, same measurement: serialized 5.4-7.9s, parallel 1.1-2.0s.
    // Serializing IS slower; the parallel runs are simply not usable.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
