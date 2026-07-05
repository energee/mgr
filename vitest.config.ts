import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    // Deterministic timezone for every test file (CI is UTC without this).
    // A behind-UTC zone is load-bearing: backward-planner's tests
    // characterize the "date-only string renders a day early" behavior,
    // which does not reproduce under UTC. Date-formatting tests must not
    // depend on the host zone — pin here, not per-file. Note: runtime TZ
    // changes are honored on POSIX only; Windows is not a supported dev
    // platform for this suite.
    env: { TZ: "America/New_York" },
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      ".github/scripts/**/*.test.ts",
    ],
    exclude: [
      // Spread the defaults: a bare `exclude` REPLACES them, un-ignoring
      // node_modules/dist for the include globs above.
      ...configDefaults.exclude,
      // Integration tests require a live Postgres instance; they run under
      // bun run test:integration (vitest.integration.config.ts), not here.
      "src/__tests__/integration/**",
    ],
    coverage: {
      provider: "v8",
      include: [
        "src/lib/**",
        "src/domain/**",
        "src/services/**",
        "src/contexts/**",
      ],
      // __tests__ covers shared fixture/helper files (e.g. purchasing
      // fixtures.ts) — vitest only auto-excludes *.test.* files, and a
      // 100%-covered fixture would prop up its directory's gate.
      exclude: ["src/lib/supabase/**", "**/__tests__/**"],
      // CI runs coverage on every push; html/clover output is never read
      // there. json-summary keeps a machine-readable rollup for tooling.
      reporter: ["text", "json-summary"],
      // Harness gate: per-directory floors set a few points under measured
      // coverage (2026-07-01) so a regression in ANY one directory fails the
      // gate — a single aggregate threshold let well-covered dirs subsidize
      // decay elsewhere. Ratchet each floor up as its dir's coverage grows.
      // See docs/agents/quality.md for the trend log. Enforced by CI
      // (test.yml) and `make check-coverage`.
      thresholds: {
        // NOTE: vitest's global thresholds always apply to ALL included
        // files as one blended aggregate — the glob entries below are
        // checked in ADDITION, not instead. Keep these at/below the
        // aggregate (74/59/74/74 measured 2026-07-01).
        lines: 50,
        functions: 50,
        branches: 50,
        statements: 50,
        "src/lib/**": {
          lines: 50,
          functions: 38,
          branches: 45,
          statements: 50,
        },
        "src/domain/**": {
          lines: 85,
          functions: 88,
          branches: 85,
          statements: 85,
        },
        "src/services/**": {
          lines: 85,
          functions: 90,
          branches: 74,
          statements: 85,
        },
        "src/contexts/**": {
          lines: 62,
          functions: 60,
          branches: 66,
          statements: 62,
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // pino is a transitive dep; alias so Vite can resolve it in the test environment.
      pino: path.resolve(__dirname, "node_modules/pino"),
    },
  },
});
