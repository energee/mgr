# Migration ↔ live-DB reconciliation (audit item #10)

**Status (2026-07-15):** repository replay repaired by issue #439. A real local
Supabase reset now replays every migration from an empty database; CI enforces
that gate. Migrations 00112 and 00254 remain pending merge and authorized live
deployment.
**DB:** local Supabase/PostgreSQL 17 via `supabase/config.toml`; no hosted data is
read or written by the replay gate.
**Audit ref:** `docs/plans/2026-06-30-codebase-audit.md` item #10 ("the DB currently cannot be recreated from migrations").

## Two separate invariants

| Invariant | Meaning | State |
|---|---|---|
| **db-push-no-op** | every local `supabase/migrations/*.sql` version has a matching `supabase_migrations.schema_migrations` row | ⏳ **PENDING DEPLOYMENT** — this branch adds 00112 and 00254 and renumbers the duplicate 00252 to 00253 |
| **recreatable-from-reset** | a fresh `supabase db reset` (apply all migrations from scratch) reproduces the intended schema | ✅ **DONE** — `make db-dry-run` replays the chain in real local Supabase (local only since 2026-08-21; the `Fresh Supabase Migration Replay` PR job was removed as duplicate signal — `E2E Tests` boots the same CLI) |

These are independent. Push only checks *which versions are recorded*; reset actually *replays the DDL*.

## Done so far

- **PR #327** (`00190_capture_out_of_band_objects.sql`): renamed 3 Phase-0 remote rows from timestamp → `00187/88/89`; captured 15 truly out-of-band objects (views/functions/triggers that existed live with zero `CREATE` in any migration). Brought files==remote to 166==166.
- **This PR** (`00191_capture_drifted_packaging_objects.sql`): captured the **18 views + 5 functions** whose live definitions had drifted from their migration definitions (the packaging-model derived objects). Verbatim from the live catalog, dependency-ordered, `security_invoker` preserved, byte-verified (body md5 `e6fccf4f592a2d069d4a5273e3057bad`; file md5 `cd98cfa22f8460f18f6eb471d3837e60`). Recorded as applied via a manual `schema_migrations` INSERT (not `apply_migration`, which assigns a timestamp version and re-creates drift). Now 167==167.
  - Objects: `keg_inventory`, `keg_inventory_summary`, `keg_turnover_metrics`, `bin_contents`, `customer_keg_balances`, `customer_keg_balance_summary`, `keg_aging_report`, `customer_keg_transaction_history`, `finished_goods_with_availability`, `finished_goods_supply_by_product`, `finished_goods_with_ttb_class`, `order_demand_by_product`, `packaging_formats`, `recipe_ingredients_normalized`, `recipes_with_estimates`, `yeast_lineage_summary`, `yeast_pitches_with_remaining`, `customers_with_order_summary`; functions `calculate_production_shortfalls`, `get_ttb_inventory_summary`, `get_ttb_production_summary`, `get_ttb_removals_summary`, `notify_all_users`.

## Resolved blocker: the packaging tables were never migrated

The packaging-formats refactor (`package_types`/`keg_types` → `selling_formats`/`containers`) was applied to **live** but its migration was **lost in the `00112–00135` squash/renumber gap**. Verified against live on 2026-06-30:

- `package_types` (created `00001`) and `keg_types` (created `00029`) are **never dropped** in any migration, but are **gone from live** (`legacy_tables_present = 0`).
- `selling_formats` (11 cols, 7 constraints, 3 indexes, 2 triggers, 2 RLS policies) and `containers` (10 cols, 6 constraints, 2 indexes, 1 trigger, 2 RLS policies) **exist live** but have **no `CREATE TABLE`/`RENAME` in any migration**.
- Migrations *use* `selling_formats` starting at `00139`, with **hard DDL** at `00160` (`... REFERENCES selling_formats(id)`, `ALTER TABLE selling_formats`). **13 FK constraints** across the DB point at the two un-created tables.

Historically, a fresh `supabase db reset` failed before migration 00160 because
`selling_formats` did not exist. Migration 00112 now restores the lost
foundation in the reserved gap, preserves legacy package/keg UUID mappings,
and lets the full chain reach the current schema. Migration 00254 then removes
the replay-only required `square_draft_sales.keg_type_id` contract after a
lossless selling-format backfill.

## Resolution implemented for #439

1. `00112_restore_out_of_band_foundations.sql` creates `containers`,
   `selling_formats`, and `email_settings` before their first references and
   rebuilds legacy UUID mappings on a fresh chain.
2. `00199_capture_selling_formats_containers.sql` remains the later convergence
   point for the full captured table shape, triggers, and policies.
3. `00254_canonicalize_square_draft_sales.sql` backfills and removes the legacy
   `keg_type_id` column, replaces its dedup index, and proves a
   selling-format-only insert in a rolling-back verification block.
4. `supabase/config.toml` and `scripts/migration-dry-run.sh` make the real
   reset repeatable. It was also a blocking PR job at the time of writing;
   that job was removed 2026-08-21 (see docs/agents/ci.md) — `E2E Tests` runs
   the same `supabase start`. The plain-Postgres shim now supplies platform roles/functions
   only and can no longer hide missing application migrations.

### Verbatim-capture method (avoids paste corruption)

Build the DDL text in SQL from the live catalog → `CREATE TABLE _recon_blob AS SELECT <text> c` → record `md5(c)` → pull back as newline-stripped base64; large MCP results auto-spill to a file under the session `tool-results/` dir, so extract with `jq`/python instead of re-emitting → `base64 -d` → check whole-file md5 → `DROP TABLE _recon_blob`. `pg_get_functiondef` errors on **aggregate** functions (`prokind='a'`); filter `prokind='f'`. Record numbered migrations with `execute_sql` (DDL) + manual `INSERT` of the `00NNN` row; never `apply_migration` (timestamp version → drift).

## Tracked live bugs — ALL RESOLVED IN-CHAIN as of 2026-07-12

> **STATUS (2026-07-12):** Every one of the 5 bugs below is now fixed in the migration
> chain and merged to `origin/main`. This section is retained for history. The only
> residual is **verifying the fixes are applied to the shared live DB** — a deploy
> question, requiring the Supabase MCP, not new code. Do NOT re-author these fixes.

**Category ② — live BEHIND migrations (migration newer than live; live was the buggy one):**
1. `generate_delivery_number` — per-date `pg_advisory_xact_lock` present in **`00075`**. ✅ chain-fixed (old migration, applied live long ago).
2. `generate_lot_number` — **`00142`** replaces the inline version with the race-safe `generate_next_number` delegate. ✅ chain-fixed.
3. `calculate_ingredient_shortfalls` — **`00150`** includes the `on_order_qty` / open-PO CTE and column. ✅ chain-fixed.
4. `get_price_for_customer` — **`00214`** (PR #354) captures the live definition verbatim into the chain (dual pricing model documented); byte-identical to live prosrc, so `db push` is a semantic no-op. ✅ chain-reconciled — no behavior change needed.

**New finding (2026-06-30) — now fixed:**
5. `get_inventory_overview` — **`00208`** (PR #346) rewrites the body off dropped `package_types`/`catalog_type`/`bin_inventory`, preserving the JSON output shape. ✅ chain-fixed. **Only open item:** confirm `00208` is applied to live (if not, live still errors when the function is invoked) — needs Supabase MCP.
