/**
 * scripts/bun-test-guard.ts — preloaded by `bun test` via bunfig.toml [test].
 *
 * Guards AGENTS.md hard constraint 14: `bun test` is Bun's own runner and is
 * NOT this repo's suite. The vitest suite runs via `bun run test`. Vitest
 * never reads bunfig's [test] preload, so this file only fires on the wrong
 * runner.
 */
throw new Error(
  "This repo's test suite is vitest, not Bun's test runner (AGENTS.md hard constraint 14).\n" +
    "Run `bun run test` (or `make check`) instead of `bun test`.",
);
