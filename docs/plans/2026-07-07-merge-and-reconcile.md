# Merge & Reconcile — 2026-07-06 audit migration batch (PRs #343–#359)

Ready-to-run checklist for landing the audit-backlog migration batch and turning
the live-drift CI green again. **Merging is a deliberate, grouped action — get
sign-off before starting.**

## Facts you must hold first

- **Migrations `00206`–`00218` are ALREADY applied to live** (Supabase project
  `phwjrfdtebftetctkhdr`) and verified. Merging only lands the migration *files*
  in git — it does **not** touch the live database.
- **`#343` is already merged** (carries `00205`, the live-drift CI, and the
  `00205`-baseline snapshot `supabase/live-catalog.snapshot.txt`).
- main's snapshot is at the **`00205` baseline**; live is at **`00218`**. So the
  daily `live-drift` workflow **and each migration PR's drift check are RED by
  design** until Step 4. This is expected, not a regression.
- The drift snapshot captures **functions, triggers, and tables only** — *not
  views*. So the `keg_inventory` (`00207`) and `recipes_with_estimates`
  (`00218`) view changes don't appear; the new/changed **functions/triggers** do
  (e.g. `guard_finished_good_outbound`, `whole_unit_material_qty`,
  `hop_utilization_factor`, `get_price_for_customer`, `get_inventory_overview`,
  `start_batch_fermentation`, the `entity_revisions` + guard triggers, and any
  new table such as `keg_filled_contents`).

## The PRs

| PR | Migration(s) | Notes |
|----|--------------|-------|
| #343 | 00205 | **MERGED** |
| #345 | 00206 | fg-entry-point |
| #344 | 00207 | keg netting (+ `keg_filled_contents` table) |
| #346 | 00208 | get_inventory_overview |
| #347 | 00209 | start_batch_fermentation |
| #348 | 00210 | vessel integrity |
| #349 | 00211 | ledger hardening |
| #350 | 00212 | availability guard |
| #353 | 00213 | entity_revisions ledger |
| #354 | 00214 | get_price_for_customer capture |
| #355 | 00215 | allocations idempotency_key |
| #357 | 00216 | finished_goods outbound guard |
| #358 | 00217 | packaging whole-unit ceiling |
| #359 | 00218 | recipe IBU → Tinseth |
| #352 | — | app-only (count CAS) |
| #356 | — | app-only (customer copy) |
| #351 | — | PROGRESS docs (+ this checklist) |

## Steps

### 0. Confirm the batch is being landed together (user decision)

### 1. Merge the PRs
- All target `main`. Migration files have **distinct numbers (00206–00218)** so
  they never conflict with each other.
- **The one recurring conflict is `docs/plans/2026-07-06-audit-fix-backlog.md`** —
  nearly every PR ticked its own item. Resolve by **keeping ALL annotations**
  (union of the ticks). `PROGRESS.md` conflicts only exist within `#351`.
- Use the repo's convention (`gh pr merge <n> --squash`). PR-number order is
  fine. Resolve the backlog-doc conflict as it arises on each merge.
- The per-PR `live-drift` check will be RED (snapshot ≠ live) — expected; merge
  anyway (admin/override if branch protection blocks on it).

### 2. Verify main has the full chain (no live writes)
```
git checkout main && git pull
ls supabase/migrations | grep -E '002(0[6-9]|1[0-8])'   # 00206–00218 all tracked
supabase db push --include-all --dry-run < /dev/null    # → "Remote database is up to date."
```
(Run `db push` with sandbox bypass; pooler host is sandbox-blocked.)

### 3. Verify app green on merged main
```
bun run lint && bun run typecheck && bun run test        # ~2028 tests green
```

### 4. Reconcile the drift snapshot (the actual fix)
Needs `psql` + a **read-only** `SUPABASE_DB_URL` to the live project. Run with
sandbox bypass (the DB host is sandbox-blocked).
```
git checkout -b chore/reconcile-live-drift-snapshot main
SUPABASE_DB_URL='postgresql://readonly:***@db.phwjrfdtebftetctkhdr.supabase.co:5432/postgres' \
  bash scripts/check-live-drift.sh --update
git --no-pager diff supabase/live-catalog.snapshot.txt
```
- **Inspect the diff**: it must be ONLY additions/body-hash changes for the
  `00206`–`00218` functions/triggers/tables listed above. **`<` lines (something
  present in the old snapshot but MISSING on live) mean a real out-of-band drop —
  STOP and investigate; do not commit.**
- Confirm green, then commit + PR + merge:
```
SUPABASE_DB_URL='...' bash scripts/check-live-drift.sh     # → "OK: ... matches ..."
git commit -am "chore(db): reconcile live-drift snapshot after 00206-00218 batch merge"
```
- **Alternative if `psql`/`SUPABASE_DB_URL` are unavailable**: run
  `scripts/live-catalog.sql` through MCP `execute_sql`, `LC_ALL=C sort` the
  emitted `line` values, and overwrite `supabase/live-catalog.snapshot.txt`.
  (Heavier — ~300+ rows.)

### 5. Confirm CI green
- Trigger the `live-drift` workflow (`workflow_dispatch`) or wait for the daily
  cron. It should pass now.
- **Still requires the read-only `SUPABASE_DB_URL` repository secret** (user
  action — outstanding). Until set, the check **self-skips** with a warning, so
  it never blocks; it just isn't actually watching.

### 6. Tidy
- Once merged, the `p2-integrity-2` worktree's untracked scaffolding
  (`00206`–`00218`) is redundant — those files are tracked on main. New branches
  off the updated main need no scaffolding. **Next migration = `00219`.**

## Safety
Merging never touches live (migrations already applied). The only destructive-
looking step is `--update` overwriting the snapshot — and that's guarded by the
diff review in Step 4. If the diff shows unexpected drops, a real out-of-band
change happened on live; reconcile that first.
