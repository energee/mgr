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
- Plain **node-env** vitest — **NO** `// @vitest-environment jsdom` (pure logic, no DOM).
- Template: `src/domain/__tests__/inventory-units.test.ts`. Supabase-mock template: `src/domain/purchasing/__tests__/po-generator.test.ts`.
- If the module imports `@/lib/supabase/client` (often a lazy `getSupabase()`), mock it; also mock `@/lib/client-logger`.
- Gate: `bun run test <file>` fully green **and** `bun run typecheck 2>&1 | grep "<file>"` prints nothing.
- Shared-worktree safety: agent touches ONLY its test file; **never** git/branch/checkout/stash/commit; if not green in ≤3 tries, `rm` its own file and report BLOCKED.
- React-context modules (`src/contexts/*.tsx`) need the render harness from `src/components/domain/recipe/__tests__/mash-schedule-editor.test.tsx` (createRoot + act, no @testing-library/react).

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
- [ ] `sales/order-number`
- [ ] `batch-readings`
- [ ] `batch-additions`
- [ ] `brew-events`
- [ ] `report-utils`
- [ ] `yeast-lineage`
### Tier 2 (lower ROI / harder)
- [ ] `contexts/prefill-store` — pure-ish store; test first of the Tier-2 set
- [ ] `services/consumption-service` — Supabase I/O (mock client)
- [ ] `services/entity-service` — Supabase I/O (mock client)
- [ ] `services/inventory-count-service` — Supabase I/O (mock client)
- [ ] `contexts/permissions` — React context (render harness)
- [ ] `contexts/portal` — React context (render harness)
- [ ] `contexts/chat-context` — React context (render harness)
- [ ] `ai/recipe-analyzer` — LLM I/O; test only pure helpers, else BLOCKED
- [~] `ai/prompts` — **SKIP** (string constants, no logic)
- [~] `services/types` — **SKIP** unless `dynamicRpc` is tractably unit-testable (types only otherwise)

## Notes
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
