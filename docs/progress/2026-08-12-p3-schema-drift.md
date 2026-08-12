# 2026-08-12 — P3 schema drift reconciled, live catalog re-baselined

- **2026-08-12 (P3 schema drift).** Closed the standing live-drift alarm (#769) by applying the two
  outstanding migrations to live with `scripts/db-push.sh --rebaseline-drift` and committing the
  regenerated `supabase/live-catalog.snapshot.txt`. The drift check now exits 0 on both of its
  assertions ("every committed migration version is applied on live" and "live database catalog
  matches the snapshot"), where it had failed every scheduled run since at least 2026-08-10.

## What the drift actually was

**The snapshot was stale. Live was not corrupted, and nothing had been hand-edited.** Every one of
the 17 lines the refresh removed traces to a committed migration in the chain. The alarm read as a
large, alarming diff only because the snapshot had not been regenerated after several pushes, so it
still carried the *old* hash lines for objects that later migrations had legitimately replaced.

The 17 removals break down as:

| Count | Source | Objects |
|---|---|---|
| 5 | the two migrations pushed here | `get_ttb_inventory_summary` (00287); `handle_vessel_transfer` and the three `reconcile_mongodb_*` functions (00288) |
| 3 | 00285 section 4, already applied | the three permissive `pricing_channel_formats` "Authenticated users can …" policies, replaced by `pricing_channel_formats_select` / `_write` |
| 9 | stale snapshot vs. already-applied 00237–00280 | `transition_entity_atomic`, `whole_unit_material_qty` (00279); `ingest_square_refund_atomic` (00277); `get_ttb_removals_summary` (00237); and five policy lines on `entity_revisions` (00275), `customers` / `customer_portal_users` / `orders` (00276), and `ai_rate_limit_buckets` (00280, whose new `ee25f986…` hash is the uniform gate hash 00280 recreates on every table) |

`--rebaseline-drift` was required because live was already divergent from the snapshot, but the
divergence was entirely of the stale-snapshot class. **No out-of-band or unreproducible change was
accepted.** This matters for the audit record: a future operator reading it should not go hunting
for phantom hand edits to the atomic-transition function or to portal RLS, because the chain
explains all of them.

## The ledger gap: 00288 was live before it was recorded

Two migrations were unapplied by the ledger, not one: the live `supabase_migrations.schema_migrations`
table stopped at `00286`, while `00287` and `00288` were both committed.

`00288`'s DDL was nevertheless already present on live — `reconcile_mongodb_transfers`, which only
`00288` creates, existed as a live function before this push. So its schema changes had been applied
without its ledger row being written, during the MongoDB historical-sync work (#770, merged earlier
the same day in `fd60d586`). Re-running it was safe (see below) and recorded the missing row.

**An earlier draft of this entry claimed `scripts/check-live-drift.sh` had under-reported the
unapplied set. That was wrong and is corrected here.** Check 1 delegates to
`scripts/compare-migration-versions.sh`, which is purely ledger-based (`comm -23` of committed
versions against `schema_migrations`) and never consults the catalog — it could not exhibit the
behavior described. The real explanation is mundane: the CI run being read was from 13:17 UTC, and
`00288` only landed on `main` later that same day, so that run legitimately saw `00287` alone. The
tooling behaved correctly.

## Safety checks before pushing

Both migrations were verified re-runnable before applying, since one of them had partially applied
already:

- `00287` is a lone `CREATE OR REPLACE FUNCTION` plus a `COMMENT`.
- `00288`'s only non-idempotent-looking statement is `ALTER COLUMN … TYPE NUMERIC` against
  `session_line_items.planned_quantity` / `actual_quantity`, both confirmed already typed `numeric`
  on live — a no-op. Its recreated `packaging_sessions_with_summary` view carries
  `WITH (security_invoker = true)` as the DB rules require.

## Tracker

F124 (per-channel format visibility) moved from `deployment.state: "pending"` to `"live"`. Its own
note said to flip it once an operator ran `scripts/db-push.sh`; `00285` is in the live ledger and
both `channel_formats` and `pricing_channel_formats` appear in the regenerated snapshot.
`make check-deploy-state` now reports 62 entries — 24 migration-backed, **24 live, 0 pending**, and
38 audited as needing no schema change. The corresponding count sentence in `AGENTS.md` is updated
in the same commit.

## Note on 00287

`00287` changes TTB Form 5130.9 beer-in-process from a live status snapshot to period-keyed history
reconstructed from `entity_revisions` (#618, unblocks #698). Previously filed months will now report
different — correct and reproducible — figures. This was applied with explicit operator approval.
