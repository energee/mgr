import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

// Deterministic timezone for the whole vitest process. Assigned here (config
// module scope, main process, before any worker spawns) because Node re-runs
// tzset() on a main-thread process.env.TZ assignment and the timezone is
// process-global — worker threads therefore inherit it. See `test.env` below.
const TEST_TZ = "America/New_York";
process.env.TZ = TEST_TZ;

// Shared exclude list for both projects (see `projects` below).
const sharedExclude = [
  // Spread the defaults: a bare `exclude` REPLACES them, un-ignoring
  // node_modules/dist for the include globs above.
  ...configDefaults.exclude,
  // Integration tests require a live Postgres instance; they run under
  // bun run test:integration (vitest.integration.config.ts), not here.
  "src/__tests__/integration/**",
];

// Directories whose tests are pure logic (no DOM): they run in the `node`
// project below, skipping jsdom environment setup entirely — jsdom
// instantiation per test file dominated suite startup (~293s of per-worker
// environment time across 188 files before the split). A test file in one
// of these dirs that genuinely needs a DOM can opt back in with a
// `// @vitest-environment jsdom` docblock, which overrides the project
// environment.
const nodeTestGlobs = [
  "src/lib/**/*.test.{ts,tsx}",
  "src/domain/**/*.test.{ts,tsx}",
  "src/services/**/*.test.{ts,tsx}",
  "src/integrations/**/*.test.{ts,tsx}",
  "src/entities/**/*.test.{ts,tsx}",
  "src/__tests__/**/*.test.{ts,tsx}",
  "src/app/api/**/*.test.{ts,tsx}",
  ".github/scripts/**/*.test.ts",
  // Harness scripts (feature-tracker gates, etc.) — pure Node, never a DOM.
  "scripts/**/*.test.ts",
];

export default defineConfig({
  plugins: [react()],
  test: {
    // Deterministic timezone for every test file (CI is UTC without this).
    // A behind-UTC zone matters: backward-planner's tests characterize the
    // "date-only string renders a day early" behavior, which does not
    // reproduce under UTC.
    //
    // This `env` entry alone is INERT under `pool: "threads"` (worker threads
    // share the parent process's timezone, and assigning process.env.TZ
    // inside a worker does not re-run tzset()). The load-bearing part is the
    // TEST_TZ assignment at the top of this file, which runs on the main
    // process before any worker spawns — timezone is process-global, so the
    // threads inherit it. `env` is kept so the value is also correct under a
    // fork/child-process runner. (issue #568)
    env: { TZ: TEST_TZ },
    globals: true,
    // Worker threads instead of child-process forks: same isolation per test
    // file, but far cheaper worker startup and module transfer. Nothing in
    // this suite needs fork-only behavior (no process.chdir, no native
    // segfault risk).
    pool: "threads",
    setupFiles: ["./src/test/setup.ts"],
    // Two projects split the suite by environment. `extends: true` inherits
    // everything above (plugins, env, globals, setupFiles, resolve aliases);
    // only `environment` + `include` differ. The jsdom project's include is
    // the full legacy glob minus the node globs, so no test file under `src/`
    // can be dropped — one in a brand-new `src/` directory lands in jsdom by
    // default. Directories outside `src/` (`.github/scripts/`, `scripts/`) are
    // node-only and must be listed in `nodeTestGlobs` to run at all.
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: nodeTestGlobs,
          exclude: sharedExclude,
        },
      },
      {
        extends: true,
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: [
            "src/**/*.test.ts",
            "src/**/*.test.tsx",
            ".github/scripts/**/*.test.ts",
          ],
          exclude: [...sharedExclude, ...nodeTestGlobs],
        },
      },
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
      // CI runs coverage on every PR; html/clover output is never read
      // there. json-summary keeps a machine-readable rollup for tooling.
      reporter: ["text", "json-summary"],
      // Harness gate: per-directory floors set a few points under measured
      // coverage (2026-07-01) so a regression in ANY one directory fails the
      // gate — a single aggregate threshold let well-covered dirs subsidize
      // decay elsewhere. Ratchet each floor up as its dir's coverage grows.
      // See docs/agents/quality.md for the trend log. Enforced by CI
      // (test.yml) and `make check-coverage`.
      // (CI ran sharded until 2026-07-16; the VITEST_COVERAGE_SHARD escape
      // hatch went with the shards — thresholds now always apply.)
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
