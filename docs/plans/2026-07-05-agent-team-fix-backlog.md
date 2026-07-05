# Agent-team fix backlog (2026-07-05)

Produced by the six-explorer evaluation (see `docs/superpowers/specs/2026-07-05-expert-agent-team-design.md`).
All candidates were verified by reading both sides of the duplication; explorers read the
(stale) local `main`, so each fix re-verifies its target at branch base `ba0ed5d5` before starting.

## Baseline (pre-campaign)

- LOC (src, ts+tsx): **161,316**
- jscpd (min-tokens 70, tests excluded): **185 clones, 4.61% duplicated lines** (6,129 / 132,974)
- depcheck advisories (ALL suspected false positives — verify before acting):
  `@tailwindcss/postcss`, `tailwindcss`, `tw-animate-css` (loaded via CSS config),
  `@vitest/coverage-v8` (coverage runs), `knip` (tool), `jsr:@supabase` "missing" (Deno edge function)

## Ranked fixes

| # | Fix | Files | Est LOC saved | Risk | Coverage exists? | Source |
|---|---|---|---|---|---|---|
| 1 | **Animated-icon factory**: extract `createAnimatedIcon()`; 50 icon files keep only unique SVG/variants. 68 byte-identical scaffold lines/file; all consumption routes through `icons/animated.tsx` `wrap()` (zero direct external consumers, grep-verified). Must explicitly decide the `waves.tsx`/`truck.tsx` mouse-handler divergence (they call `onMouseEnter?.(e)` unconditionally; the other 48 only when ref-controlled) — parametrize, don't silently normalize. Add a few smoke tests first. | `src/components/icons/{flask,ship}.tsx` + 48 `src/components/ui/*.tsx` | **~2,600–2,900** | Low (med on the 2 divergent files) | No → add smoke tests | ui explorer + jscpd |
| 2 | **Test-harness migration**: 16 test files hand-roll the 16-line `render()`/`afterEach` block that `src/test/react-harness.ts` `setupRenderHarness()` already provides (3 files migrated previously). Also delete the manual mid-test unmount block in `mash-schedule-editor`/`fermentation-schedule-editor` (harness self-cleans). Opportunistically unify the `vi.mock("@/lib/supabase/client")` one-liners in touched files. | 16 files across `recipe|batch|inventory|order|packaging|purchasing/__tests__`, `ui`, `universal`, `contexts` | **~220** (test code) | Low | Is test code | test explorer |
| 3 | **Gravity/temperature formula unification** — `src/domain/batch-readings.ts` has its own `convertGravity`/`convertTemperature` that diverge numerically (~0.0002–0.0007 SG) from canonical `src/domain/units.ts`; same stored Plato shows different SG in readings vs packaging. **NOT behavior-preserving** — one call path's numbers must change. Needs a product decision on which formula wins. | `src/domain/batch-readings.ts`, `src/domain/units.ts` | ~25 (value is correctness, not LOC) | Med | Partial (`src/domain/__tests__`) | brewing explorer — **bug-fix track, needs user decision** |
| 4 | **backward-planner reuse**: `getProductionRequirements` inlines the demand-group-key + `max(0, demand-available-inProduction)` shortage math that `allocation-calculations.ts` exports (`demandGroupKey`, `aggregateDemand`, `calculateShortage`). Swap loop body to the pure helpers; watch tie-breaking. | `src/domain/planning/backward-planner.ts` | ~15 | Low | Yes (domain tests) | brewing explorer |
| 5 | **Enum-from-options derivation**: `vessel`/`bin`/`allocation` cores each declare `{value,label}[]` options AND hand-retype the literals into `z.enum()` — the drift class behind the historical `'hops'→'hop'` bug (`93f944a3`). Derive enum from array via a helper next to `statesAsOptions` in `src/types/entity.ts`. | `src/entities/{vessel,bin,allocation}/core.ts`, `src/types/entity.ts` | ~20–30 (drift-risk reduction) | Low | Registry test partial | entity explorer |
| 6 | **po-generator MOQ calc**: same 3-line `min_order_qty` clamp duplicated twice in one file. | `src/domain/purchasing/po-generator.ts` | ~5 | Low | Yes | brewing explorer |

## Explicit non-actions (documented so nobody "fixes" them later)

- **Migrations `00129`/`00136` and `00130`/`00137`** are byte-identical squash artifacts — **do not delete**; both members of each pair are recorded in live `schema_migrations`.
- **`ttb-utils.ts` 31 gal/bbl vs `units.ts`**: intentional separation — one is a pinned federal regulatory constant, the other a display-conversion table. Document, don't merge.
- **Chart `-lazy.tsx` wrappers** (3 files): pattern repetition is real but a shared helper wouldn't clear the indirection cost.
- **13× `name: z.string().min(1)` / `is_active: z.boolean().default(true)`**: byte-identical single lines; a shared constant is net-neutral.
- **B1/B2/B3 editor merges**: investigated and blocked in `docs/plans/2026-06-30-dedup-extraction-backlog.md` (divergent state models); characterization coverage is now complete (PRs #329/#330) but the merges remain low/negative value.
- **B5 `dynamicOptions`**: still needs a feature-design pass; not behavior-preserving.

## Success criteria

- jscpd duplicated-lines % below 4.61% baseline after fixes land
- Suite stays green (~1,547+ tests), `tsc --noEmit` clean, 0 lint warnings per PR
- Fix #1 alone should cut src LOC by ~1.6%

## Campaign selection (this session)

Fixes **#1** and **#2** (top LOC value, low risk). #3 awaits a formula decision; #4–#6 are future small-batch work.

## Results (2026-07-05 campaign)

| Fix | PR | LOC delta | Gate |
|---|---|---|---|
| #1 animated-icon factory | [#335](https://github.com/energee/mgr/pull/335) | **−2,064** (1,133+/3,197−) | BEHAVIOR-PRESERVING: yes (after one repair round — 3 icons with custom `startSequence`/`stopSequence` animation sequences initially no-opped by the generic factory; caught by review, fixed via escape hatch, +4 sequence tests) |
| #2 test-harness migration | [#334](https://github.com/energee/mgr/pull/334) | **−295** (85+/380−) | BEHAVIOR-PRESERVING: yes (1,937 tests identical before/after) |

- **Total: −2,359 net LOC** (~1.5% of src) across two PRs; suite grew to 1,957 tests (+20 icon smoke/sequence tests)
- Worktree prune (Phase 0): 0 of 48 candidates safely removable — 35 hold unmerged work, 12 dirty, 1 out-of-scope; E2BIG mitigated per-command instead
- New follow-up candidate: `form-actions.test.tsx` harness migration (reuses one container across sequential renders; needs test-body rewrite)
- Fix #3 (gravity-formula divergence) still awaits a product decision on which formula wins
- Post-merge: re-run the jscpd baseline to confirm duplicated-lines % drops below 4.61%
