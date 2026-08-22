# Fable punch list — 2026-08-21

Ranked improvement tasks specced for independent execution by a cheaper model.
Produced by a read-only Fable 5 audit against `main` @ `c934e6ff`. Sources:
`docs/agents/quality.md` grades (auth B−, purchasing B−, hooks/domain-components B),
the 10 open issues, `docs/plans/2026-08-21-schema-audit.md`,
`docs/plans/deferred-gaps.md`, and `rg "ponytail:"`.

Recent work already done and **not** re-proposed: ponytail items 15/18–24 (all
closed or rejected 08-21), migration-number collision + CI guard (#920/#923),
loading-audit items 1–8 (item 8 residue deliberately kept), state-machine parity
test (#919), 00219/00221 characterization (#918), QBO atomic RPC 00299,
status-preserving upserts 00300, drift exit-code test, #737 backslash
open-redirect (fixed in `src/lib/auth-utils.ts`, tested), #859 page-size
restore. Only one open PR (codegraph bot) at audit time — nothing below was in
flight.

**General rules for every task:** work in a `scripts/agent-worktree` worktree
(never migrations on main); migration numbers must be re-derived at execution
time via `ls supabase/migrations/ | tail -1` (highest was `00300` at audit
time); follow `docs/agents/db-security.md` for SQL; update `docs/data-model/`
in the same commit for schema changes.

## Ranked tasks

**1. Fix `enum_values` registry drift blocking keg receive/ship (#917) and vessel writes (#907)** — M, sequential (do first; task 3 depends on the vocabulary being right)
- Files: new migration `supabase/migrations/003XX_fix_enum_registry_drift.sql`; seeds at `supabase/migrations/00037_enum_registry.sql:197–204`; trigger at `00040_enum_validation_triggers.sql` (reads the registry — one migration fixes both issues).
- Change: DELETE the registry rows for `keg_transaction_type` and `vessel_type`, INSERT rows matching the authoritative pg enums (`receive,fill,ship,return,clean,adjust,retire,maintain` and `fermenter,brite,kettle,mash_tun,hlt,unitank,foeder,barrel` — verify against `Database["public"]["Enums"]` in `src/types/supabase.ts`). Preserve the metadata-jsonb shape of 00037's rows for values that survive.
- Why: on any chain-replayed DB, 5 of 8 keg transaction types are rejected — keg fleets can't be received, `create_keg_ship_transactions_from_order` (00229/00234) can't run, and keg-netting integration coverage was unreachable. `unitank`/`hlt` vessels can't be written at all.
- Also add: an integration test in `src/__tests__/integration/` asserting, for every enum-typed column with a `validate_enum_value` trigger, registry values == `enum_range` (allowlist any intentional divergence found, with a comment). This prevents the whole class.
- Acceptance: `make db-local && bun run test:integration` green (new test included); `make check` green. Live-apply is an operator step — record `deployment: pending` per AGENTS.md conventions if `SUPABASE_DB_URL` is absent.

**2. `scripts/db-push.sh` must regenerate `src/types/supabase.ts` (#912)** — S, parallel
- Files: `scripts/db-push.sh`; `AGENTS.md` Migrations section.
- Change: run `bun run db:generate` alongside the snapshot regeneration; AGENTS.md note that pushes commit migrations + snapshot + types together.
- Why: every push currently leaves types stale; the next regeneration bundles unrelated drift into unreviewable diffs (bit #878).
- Acceptance: `make check-fast`; `bash -n scripts/db-push.sh`; grep shows the generate step between push and commit guidance.

**3. Characterize `receive_purchase_order_items` (money/state path, zero coverage)** — M, parallel
- Files: new `src/lib/__tests__/po-receive-sql.test.ts` using the existing idiom in `src/lib/__tests__/sql-def-helpers.ts` (use `findWinningDefinition`-style resolution — **00249 amends 00248**, so pin the winning body, not a filename); new `src/services/__tests__/po-receiving-service.test.ts`.
- Change: SQL-text assertions pinning the fulfilled/partial rule, over-receive rejection, unknown-line rejection, illegal-transition rejection, zero/negative-qty no-op, and single-transaction shape; unit tests for the payload mapping in `src/services/po-receiving-service.ts` (`globalNotes` precedence over per-entry notes, `""`→`null` coalescing on lot/expiration/notes).
- Why: `po-receiving-service.ts` is the only write service with no direct test; purchasing is B− with "few dedicated tests" and this is its money/state transition.
- Acceptance: `bun run test` green; new files listed in the run; `make check-fast`.

**4. Docs reconciliation: schema-audit step 7 + stale plan entries** — S, parallel, zero risk
- Files: `docs/data-model/` (add/extend per `docs/plans/2026-08-21-schema-audit.md` step 7: format-id lineage, money-precision convention, integration settings/sync-log conventions, yeast duality); `docs/plans/deferred-gaps.md`.
- Change: write the four doc-only conventions the audit deferred; mark the deferred-gaps "Hardcoded 7-Day Lead Time" item resolved (current code `src/domain/purchasing/po-generator.ts:117,156` already uses `Math.max(...lead_time_days, 7)` — 7 is now a floor, and the cited path `src/lib/purchasing/` no longer exists).
- Acceptance: `make check-fast`; the four topics appear in `docs/data-model/`; deferred-gaps shows the item struck through with the file:line evidence.

**5. Close out issue #855 with verification pointers** — S, parallel
- Change: verify and comment that all three deferred items landed — `save_qbo_tokens_atomic` (00299, PR #903), DB-side status-preserving upserts (00300, PR #906), drift exit-code contract test (PR #881) — then `gh issue close 855` citing those commits.
- Why: fully-done issue polluting a 10-issue triage queue.
- Acceptance: issue closed with a comment naming the three commits/migrations.

**6. Unit tests for the logic-bearing untested hooks** — M, parallel
- Files: `src/hooks/use-suggested-number.ts`, `src/hooks/use-prefill-hydration.ts` → new tests in `src/hooks/__tests__/` (7 of 25 hooks tested today; use `src/test/react-harness.ts` + `src/test/supabase-mock.ts`).
- Change: cover `use-suggested-number`'s duplicate-probe path (the `escapeLikePrefix` fail-open hazard documented in reorder.ts — an empty probe result must not hand back an existing number) and `use-prefill-hydration`'s hydrate/skip branches.
- Why: hooks row is B, "no dedicated test files" was the cited reason; these two carry real logic (numbering collisions are user-visible data bugs).
- Acceptance: `bun run test` green; coverage for the two files > 0 in the run summary.

**7. Pick-list bin-level detail + location sort (deferred-gaps, two Medium items)** — L, sequential after 1 (both touch migrations; avoid number races)
- Files: new migration adding `pick_list_items.bin_id UUID REFERENCES bins(id)`; update `generate_pick_list` (winning definition — search the chain) to record bin and set `sort_order` by `location_name → bin_name → lot_number`; display bin in `src/components/domain/pick-list-items.tsx`; update `docs/data-model/`.
- Why: warehouse pickers lost bin detail when legacy `OrderPickList` was removed 2026-08; spec is already written in `docs/plans/deferred-gaps.md` ("Pick List System").
- Acceptance: `make check` green (includes `make check-db`); a vitest sql-text test pins the new sort rule; `deployment: pending` recorded.

**8. Reproduce-then-fix #775: mongodb replay trips the live-transfer occupancy trigger** — M, sequential, integrations-expert territory
- Files: start at `src/integrations/` mongodb sync's `vessel_transfers` upsert; `supabase/migrations/00288_mongodb_sync_replay_fixes.sql` (the existing replay-fix pattern that evidently doesn't cover this trigger).
- Change: step 1 — write a failing integration test replaying a historical transfer over a vessel with a live transfer; step 2 — minimal fix extending the 00288 reconcile pattern (do **not** disable the trigger globally). If step 1 can't reproduce, comment findings on #775 and stop.
- Acceptance: new integration test red-then-green; `bun run test:integration` and `make check` green.

**9. Unify the two colliding DEC-SEC series** — S, parallel, docs-only
- Files: `docs/spec/decisions.md` (DEC-SEC-001 CSP, DEC-SEC-002 rate limiting, DEC-SEC-009 dev-login), `docs/spec/architecture.md` (its own DEC-SEC-001–008), `docs/agents/db-security.md` (references "DEC-SEC-001 through DEC-SEC-003" meaning architecture.md's).
- Change: the same IDs name different decisions in the two files. Renumber the `decisions.md` entries into a non-colliding range (or a distinct prefix), fix every cross-reference (`rg "DEC-SEC" docs/ src/`), and add a one-line note in each file saying where each series lives.
- Why: ambiguous decision IDs defeat the point of having IDs; found 2026-08-21 while filing DEC-SEC-009.
- Acceptance: `rg "DEC-SEC" docs/ src/` shows every ID unique across both files; `make check-fast`.

**10. Correct the #691/#692 record and the dev-login route docstring** — S, parallel
- Files: GitHub issues #691, #692; `src/app/api/auth/dev-login/route.ts` docstring.
- Change: both issues were closed as "completed" with no code, no PR, no comment — reclassify closure reason to "not planned" with a one-line comment pointing at DEC-SEC-009 (declined, with rationale). Update the route docstring, which still says interface binding/shared secret are "tracked as issue #691"/"#692", to say they were declined per DEC-SEC-009.
- Why: the closures currently assert shipped work that never happened; the docstring points at dead trackers.
- Acceptance: `gh issue view 691 --json stateReason` shows NOT_PLANNED (same for 692); route docstring references DEC-SEC-009; `make check-fast`.

## Skip list

- #679 dev-login admin-grant design — needs-human (recommendation filed as DEC-SEC-009). Blanket `USING (true)` RLS tightening (kegs/QBO/Slack) — risky. #549 preferred-supplier re-mark — live-data/operator. #833/#832 — credentials. #785 cwd-resolution — harness-design. Loading item 8 (161 inline skeletons) — re-audited-and-kept. inventory-count CAS ponytail — condition-unmet. `get_inventory_overview` "broken live" — fixed (00208). Duplicate 00298 — fixed (#920). quality.md stale facts — auto-regraded. knip dead-code sweep — false-positive-prone. Permissive-RLS allowlist shrink — risky. packaging/material-planning service tests — covered (pure logic tested via `use-packaging`/`use-material-planning` + domain tests).

## Parallelism

Tasks 2, 3, 4, 5, 6, 9, 10 are mutually parallel-safe (disjoint files); 1 before
3's allowlist decisions and before 7/8's migration numbering.
