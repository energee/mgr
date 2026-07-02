# Domain test-coverage loop — resume ledger

**Scope:** tests-only, **NO production refactor** (user decision 2026-07-01). Add vitest tests
for the untested Tier 1 + Tier 2 `src/domain` / `src/services` / `src/contexts` modules.
**Branch:** `refactor/domain-simplify-tests` (off `main` @ d812ea4b) · **Worktree:** `.claude/worktrees/simplify`.

## Cost protocol (why this doc exists)
The session cost guardrail is **per-session**; it fires `COST CRITICAL` once cumulative session
cost is high, and it propagates into subagents (they self-halt). Workaround: work in batches of
**~4–5 modules per session**; when the CRITICAL alert fires, the user runs **`/clear`** (resets the
per-session counter) and then says **"resume domain test loop"**. A fresh session reconstructs state
from this file + `git log --oneline`.

## Resume recipe (fresh session)
1. `cd` the worktree, `git branch --show-current` → must be `refactor/domain-simplify-tests`.
2. Read this file's checklist + `git log --oneline d812ea4b..HEAD` to see what's committed.
3. For the next few unchecked modules, spawn one **sonnet** general-purpose agent each (prompt below).
4. As each returns green: run the gate, commit **one file per commit**, check its box here, commit the ledger.
5. Stop the batch before cost goes CRITICAL; tell the user to `/clear` + resume.

## Idiom (give each agent)
- Pure-logic files need `// @vitest-environment node` as line 1 — the vitest.config default is **jsdom**, so omitting the pragma does NOT give you node env.
- Template: `src/domain/__tests__/inventory-units.test.ts`. Supabase mock: use the shared `src/test/supabase-mock.ts` (`makeSupabase`/`throwingSupabase`) — do not hand-roll per-file fakes.
- If the module imports `@/lib/supabase/client` (often a lazy `getSupabase()`), mock it; also mock `@/lib/client-logger`.
- Gate: `bun run test <file>` fully green **and** `bun run typecheck 2>&1 | grep "<file>"` prints nothing.
- Shared-worktree safety: agent touches ONLY its test file; **never** git/branch/checkout/stash/commit; if not green in ≤3 tries, `rm` its own file and report BLOCKED.
- React-context modules (`src/contexts/*.tsx`) use the shared render harness `src/test/react-harness.ts` (`setupRenderHarness()` — createRoot + act with auto-cleanup, no @testing-library/react).

## Checklist
### Tier 1 (pure logic — highest ROI)
- [x] `ttb-utils` — 12 tests — `acab047d`
- [x] `units` — 12 tests — `2860fd68`
- [x] `water-chemistry` — 10 tests — `8b7e64e1`
- [x] `allocation-calculations` — already covered: 64 tests in `src/lib/__tests__/allocation-calculations.test.ts` (green)
- [x] `purchasing/landed-cost` — 26 tests (pure helpers + async RPC, mocked) — `f939990d`
- [x] `purchasing/demand-calculator` — 33 tests (pure helpers + async, mocked) — `dc80462a`
- [x] `yeast-calculations` — already covered: 53 tests in `src/lib/__tests__/yeast-calculations.test.ts` (green)
- [x] `planning/backward-planner` — 22 tests (pure helpers + async, mocked) — `c74035c4`
- [x] `consumption-planning` — 51 tests (pure FIFO/BOM/loss math) — `e1a9a8cf`
- [x] `batch-schedule` — 18 tests (pure date/phase math) — `0bb5f6dd`
- [x] `sales/order-number` — 5 tests (RPC mocked) — `ea05f46a`
- [x] `batch-readings` — already covered: 32 tests in `src/lib/__tests__/batch-readings.test.ts` (green)
- [x] `batch-additions` — already covered: 8 tests in `src/lib/__tests__/batch-additions.test.ts` (green)
- [x] `brew-events` — already covered: 39 tests in `src/lib/__tests__/brew-events.test.ts` (green)
- [x] `report-utils` — 20 tests (fake Supabase builder) — `51037d1e`
- [x] `yeast-lineage` — 12 tests (fake Supabase client) — `0b6d7445`
### ✅ Tier 1 COMPLETE
### Tier 2 (lower ROI / harder)
- [x] `contexts/prefill-store` — 21 tests (jsdom sessionStorage) — `4d7ed16b`
- [x] `services/consumption-service` — 36 tests (fake Supabase builder) — `3f587c22`
- [x] `services/entity-service` — 40 tests (fake Supabase builder; `transition()` already covered by `entity-transitions.test.ts`) — `5a39266b`
- [x] `services/inventory-count-service` — 14 tests (fake Supabase builder) — `c2971496`
- [x] `contexts/permissions` — 10 tests (createRoot+act harness) — `798d8bee`
- [x] `contexts/portal` — 5 tests (createRoot+act harness) — `1666de21`
- [x] `contexts/chat-context` — 19 tests (createRoot+act; usePathname/useChat mocked) — `ff23c66c`
- [x] `ai/recipe-analyzer` — 8 tests (NOT LLM I/O — just 2 RPC wrappers; fake Supabase client) — `dfaa866b`
- [~] `ai/prompts` — **SKIP** (string constants, no logic)
- [~] `services/types` — **SKIP** unless `dynamicRpc` is tractably unit-testable (types only otherwise)

## Notes
- Batch 5 (2026-07-01, final): **CHECKLIST COMPLETE.** 4 files (42 tests) — recipe-analyzer `dfaa866b` (8),
  permissions `798d8bee` (10), portal `1666de21` (5), chat-context `ff23c66c` (19). `ai/recipe-analyzer`
  turned out NOT to be LLM I/O — just two thin RPC wrappers → tested like order-number (fake client), written
  inline (no agent). The 3 React contexts used the createRoot+act harness (no `@testing-library/react` in repo);
  chat-context mocked `next/navigation.usePathname` + `@ai-sdk/react.useChat`. Quirks pinned: permissions
  `hasRole()` ignores PERMISSION_MAP (customer passes hasRole but can()=false) + memo is by array reference;
  chat-context "UUID" regex `/^[0-9a-f-]{36}$/i` accepts 36 dashes + rebuilds pageContext/transport every render.
  All 4 context/hook modules throw when their hook is used outside the provider (pinned).
  **DONE:** lint fixes for the new context/service tests (react-compiler immutability → module-level
  capture in useEffect; unused fake-builder args → `_`-prefixed). Finish-line gate green:
  `bun lint` (0/0), `bun typecheck` (0), `bun run test` (109 files, 1921 tests — NOT `bun test`,
  which invokes Bun's native runner instead of vitest). **PR: https://github.com/energee/mgr/pull/330**
- Batch 4 (2026-07-01, session 3 cont.): **all 4 tractable Tier-2 modules done** (111 tests) —
  inventory-count-service `c2971496` (14), entity-service `5a39266b` (40), consumption-service `3f587c22` (36),
  prefill-store `4d7ed16b` (21). All services take `SupabaseClient` as a param → fake query-builder, no `vi.mock`.
  entity-service's `transition()` was already covered by `entity-transitions.test.ts` (skipped). prefill-store
  needed jsdom + a `Object.getPrototypeOf(sessionStorage)` spy workaround (documented in-file). Quirks pinned:
  consumption-service reports `shortfall:0` for an unmatched ingredient (not the full required qty) and sets
  allocation `quantity == volume_bbl` in `recordBatchLoss`; inventory-count-service reports `id:"unknown"` on a
  lot-read NOT_FOUND; prefill-store's `write()` persists `setPrefill({})` instead of clearing (empty obj truthy).
  **Remaining Tier 2:** 3 React-context modules (permissions/portal/chat-context — need render harness) +
  ai/recipe-analyzer (LLM I/O, pure helpers only). Deferred to next session for cost reset.
- Batch 3 (2026-07-01, session 3): **Tier 1 finished.** 3 new files green (37 tests) —
  order-number `ea05f46a` (5, RPC mocked), report-utils `51037d1e` (20, fake Supabase builder),
  yeast-lineage `0b6d7445` (12, fake Supabase client). Also ticked 3 already-covered freebies
  (batch-readings 32 / batch-additions 8 / brew-events 39, all in `src/lib/__tests__/`, green).
  Quirks pinned as characterization (not fixed): `yeast-lineage.resolveYeastLineageRoot` falls back
  to client walk when RPC resolves `data:null`, has no cycle detection (unbounded loop on A→B→A),
  and on a broken parent returns the *original leaf* `pitchId` not the last-resolved ancestor;
  `report-utils.fetchBatchIngredientDetail` swallows the `inventory_lots` query error and can leak a
  lot name across rows sharing a `source_id`; `order-number` does no shape check on the RPC result.
- Batch 2 (2026-07-01, session 2): 5 new files green (150 tests) — landed-cost `f939990d`,
  demand-calculator `dc80462a`, backward-planner `c74035c4`, consumption-planning `e1a9a8cf`,
  batch-schedule `0bb5f6dd`. Also discovered `allocation-calculations` (64) + `yeast-calculations` (53)
  were **already covered** by pre-existing tests in `src/lib/__tests__/` (not co-located, so the ledger
  missed them) — ticked, no new work. Two behavior quirks pinned as characterization (not bugs fixed):
  (1) `backward-planner.formatPlanningDate` parses `YYYY-MM-DD` as UTC midnight → renders one day earlier
  in non-UTC test TZ; (2) `backward-planner.getProductionRequirements` never applies finished-goods
  inventory to TBD requirements, so a TBD item's shortage always == total_demand.
- Batch 1 (session 1): 3/6 salvaged green (ttb/units/water-chemistry); `allocation` + `landed-cost`
  agents self-halted on the cost hook (wrote nothing); `demand-calculator` was killed mid-write.
- When all boxes are done: final `bun lint && bun run typecheck && bun run test` green, then open a PR.
