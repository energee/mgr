# 2026-08-12 — P3 schema drift reconciled, live catalog re-baselined

- **2026-08-12 (P3 schema drift).** Closed the standing live-drift alarm (#769) by applying the two
  outstanding migrations to live with `scripts/db-push.sh --rebaseline-drift` and committing the
  regenerated `supabase/live-catalog.snapshot.txt`. The drift check now exits 0 on both of its
  assertions ("every committed migration version is applied on live" and "live database catalog
  matches the snapshot"), where it had failed every scheduled run since at least 2026-08-10.

## What the drift actually was

The alarm conflated two unrelated problems, which is why it read as a large diff:

1. **The snapshot was stale, not live.** Most of the reported "missing/changed" objects were the
   snapshot's *old* hash lines for objects that migrations 00281 / 00282 / 00288 had already
   replaced on live — `data_integrity_findings` and its policies (00281), the
   `tr_enum_values_revision` / `tr_supplier_catalog_revision` triggers (00282), and the
   `reconcile_mongodb_*` functions (00288). Nobody had regenerated the snapshot after those pushes.
2. **Live was genuinely behind main by two migrations**, not one.

## Discovery: the drift checker under-reported unapplied migrations

`scripts/check-live-drift.sh` reported exactly one committed-but-unapplied version (`00287`).
`supabase db push --dry-run` reported **two** (`00287` and `00288`), and querying
`supabase_migrations.schema_migrations` directly confirmed the ledger stopped at `00286`.

The cause is that **00288's DDL had been applied to live out-of-band** — `reconcile_mongodb_transfers`
already existed as a live function — but its ledger row was never recorded, presumably during the
MongoDB sync production migration (#770). The catalog-level comparison therefore saw 00288's objects
present and did not flag it, while the ledger-level comparison should have. Worth a follow-up: the
two halves of the check can disagree, and the ledger half is the one to trust for "is it applied".

Both migrations were verified re-runnable before pushing: 00287 is a lone
`CREATE OR REPLACE FUNCTION` plus a `COMMENT`; 00288's only non-idempotent-looking statement is an
`ALTER COLUMN ... TYPE NUMERIC` against columns already typed `numeric` (a no-op), and its recreated
`packaging_sessions_with_summary` view carries `WITH (security_invoker = true)` as the DB rules require.

## Re-baselined objects

`--rebaseline-drift` was required because live was already drifted. Of the 17 snapshot lines the
refresh removed, nine map to the migrations just pushed (`get_ttb_inventory_summary` from 00287;
`handle_vessel_transfer` and the three `reconcile_mongodb_*` functions from 00288). **The remaining
eight did not** — `get_ttb_removals_summary`, `ingest_square_refund_atomic`,
`transition_entity_atomic`, `whole_unit_material_qty`, and five policy lines on
`ai_rate_limit_buckets` / `customer_portal_users` / `customers` / `entity_revisions` / `orders` —
and were pre-existing out-of-band changes now accepted as the new expected state. They are recorded
here rather than only in a terminal scrollback so the acceptance is auditable.

## Tracker

F124 (per-channel format visibility) moved from `deployment.state: "pending"` to `"live"`. Its own
note said to flip it once an operator ran `scripts/db-push.sh`; 00285 is in the live ledger and both
`channel_formats` and `pricing_channel_formats` appear in the regenerated snapshot.
`make check-deploy-state` now reports 62 entries — 24 migration-backed, **24 live, 0 pending**, and
38 audited as needing no schema change.

## Note on 00287

00287 changes TTB Form 5130.9 beer-in-process from a live status snapshot to period-keyed history
reconstructed from `entity_revisions` (#618, unblocks #698). Previously filed months will now report
different — correct and reproducible — figures. This was applied with explicit operator approval.
