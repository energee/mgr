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
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
