# Database Schema Audit — 2026-08-21

Full-schema review of `mgr` (109 live tables, 146 functions), run as five parallel domain auditors (recipes/ingredients, production, inventory/purchasing, sales/pricing, integrations/system) over the codegraph, migration DDL, and exact ref-counts, cross-checked against `codegraph doctor`. Read-only — no changes made. CONFIRMED = ref-counted or DDL-verified, SUSPECTED = needs a live-DB check.

## High severity

**H1. `recipe_variants` subsystem is dead at the app layer (CONFIRMED).** Five tables (`recipe_variants`, `recipe_variant_{hops,adjuncts,fruits,spices}`) plus the `recipe_variants_with_costs` view have zero app reads/writes. Nothing ever inserts a variant, so `batches.recipe_variant_id` can never be populated. Worse, `src/entities/batch/core.ts:113-118` declares a `belongsTo` relation to entity `"recipe_variant"` which is **not registered anywhere** — a dangling entity reference. → Decide: build the variants UI or retire all five tables; either way fix the dangling relation now.

**H2. `packages` is a dead table (CONFIRMED).** Zero readers/writers in app or SQL; superseded by `finished_goods` + `selling_formats`, yet still live with 3 RLS policies and even maintained (00159 bolted `selling_format_id` onto it). → Verify live row count, then drop (table + `_schema_registry` row + regen types).

**H3. `vessel_cleanings` has no write path (CONFIRMED).** Only reference is a read in the AI chat tool (`src/app/api/chat/tools.ts:477`); no INSERT exists in src/ or migrations. The table and its `recent_vessel_cleanings` view can only ever be empty. → Wire cleaning capture into the vessel flow or drop table + view + enum.

**H4. `recipe_collaborators` is a dead table (CONFIRMED).** Zero references outside generated types; live with RLS; FKs `auth.users` directly. → Drop candidate.

**H5. No log table is ever pruned (CONFIRMED).** `cleanup_old_notifications()` exists but is scheduled nowhere; `square_sync_log` (row per webhook), `qbo_sync_log` (full request/response payloads per attempt), `mongodb_sync_log`, `slack_notification_log`, `email_notification_log`, and `entity_revisions` (full before/after JSONB per write) all grow unbounded. → One pg_cron retention job covering the log family.

**H6. Suspected chain↔live column drift on `finished_goods` / `packages` (SUSPECTED).** The migration chain creates `finished_goods.package_type_id`/`keg_type_id` and `packages.package_type_id` and never drops them, but live-generated types lack them (and disagree on `packages.selling_format_id` nullability). Likely the uncaptured remainder of the known 34-line live↔chain delta (#10 residuals). → Capture in the 00269/00283/00284 style (or moot it for `packages` via H2).

## Medium severity

**M1. Dead columns, ready to drop after a live-NULL check (CONFIRMED ref-count 0):**
- `yeast_pitches.batch_id`, `.pitched_at`, `.cell_count_billion`, `.current_viability` — superseded by `yeast_pitch_events` (00158); needs view rebuilds (`yp.*`).
- `recipes.ingredients`, `.instructions` (legacy JSONB), `.batch_size_gallons`, `.boil_time_minutes`, `.style` (TEXT next to `style_id`) — the dead JSONB is still re-selected by `recipes_with_estimates` on every list fetch.
- `order_items.package_id` — vestigial from schema v1.
- Catalog dead fields: `hops.{hsi,myrcene_percent,humulene_percent,caryophyllene_percent,farnesene_percent,substitutes}`, `malts.max_percentage`, `sugars.fermentability`, `fruits.sugar_content`, `spices.cost_per_unit`, `additives.cost_per_unit`, `recipe_yeasts.{pitch_rate,fermentation_temp_f}` (confirm MongoDB sync doesn't write them first).

**M2. `pricing_channel_formats` — dead, already scoped for retirement (#724) (CONFIRMED).** Only generated-types references; migration 00285 itself labels it "SUPERSEDED… DEAD". Its `format_id` has no FK. → Execute #724.

**M3. `orders.status` has no CHECK constraint (CONFIRMED).** The enum lives in a comment; enforcement is only the transition trigger, which 00271 itself bypassed via replica mode. `pick_lists`, `deliveries`, `order_change_requests`, `allocations`, `beer_order_import_runs` all have CHECKs; orders is the odd one out. → Add CHECK matching the state machine.

**M4. `_schema_registry` advertises the dropped `batches.fermenter` column (CONFIRMED).** `key_fields` was set in 00005 and never corrected after 00209 dropped the column — the AI layer (`get_ai_schema_context`) is being told about a nonexistent column. → One-line registry-correction migration.

**M5. Missing FKs on `notifications.user_id` / `notification_preferences.user_id` (CONFIRMED).** Sibling per-user tables all cascade from `auth.users`; deleting a user orphans notification rows. → Add FK + ON DELETE CASCADE.

**M6. `batch_blends` missing constraints (CONFIRMED).** No `CHECK (blend_batch_id <> source_batch_id)` (self-blend possible) and FKs default to NO ACTION while every sibling batch child table cascades. → Add CHECK + explicit ON DELETE.

**M7. `transfer_lines.quantity` is INTEGER (CONFIRMED type mismatch).** Lines can reference `inventory_lots` whose quantities are DECIMAL(10,4); a 12.5-lb lot can't be transferred (UI even `parseInt`s). → Decide unit-count-only by design, or widen to NUMERIC.

**M8. Two sources of truth for recipe yeast (CONFIRMED).** Editor writes scalar `recipes.yeast_id`; `recipe_yeasts` rows come only from MongoDB sync and the clone dialog. Similarly, `save_recipe_aggregate_atomic` covers 6 of 8 satellites — `recipe_yeasts` and `recipe_additions` are edited via separate non-atomic paths. → Converge or document.

**M9. Two sources of truth for lot location (CONFIRMED).** `inventory_lots.location` is free TEXT (pre-dating bins) and still read by `inventory-service.ts`, competing with `bin_inventory_items`. → Deprecate the TEXT column once UI parity exists.

**M10. QBO secrets live in `system_settings` (CONFIRMED, noted).** Square/Slack have dedicated singleton settings tables + safe views; QBO stores OAuth tokens + client secret as rows in the generally-readable key-value table (mitigated by a RESTRICTIVE policy). Four different integration-settings patterns overall. → Document one sanctioned pattern; consider moving QBO secrets.

**M11. `email_settings` / `email_notification_log` are DB-only (CONFIRMED).** Alive via the `notify_all_users → send-email` pipeline but no app UI reads or manages them, and `email_settings` lacks the singleton guard its Square/Slack siblings have. → Add singleton constraint; build or document.

## Low severity / informational

- **Constraint-tightening bundle** (one future migration): positivity CHECKs on `vessel_transfers.volume_bbl`, `brew_log_batches.volume_bbl`, `session_line_items.*_quantity`, `po_receives.quantity`, `transfer_lines.quantity`, and all 00011 recipe-junction amounts; `CHECK (quantity >= 0)` + `version` parity for `bin_inventory` vs `bin_inventory_items`; `locations` UNIQUE(name); CHECK on `batch_logs.log_type`.
- **Missing catalog-side FK indexes** on `recipe_{adjuncts,sugars,spices,fruits,additions}` — their `ON DELETE RESTRICT` FKs force seq scans on catalog deletes.
- **`allocations_legacy`** — frozen by design (select-only RLS) but retention is unbounded. **`_backup_fulfill_past_orders`** — deliberate rollback preimage from 00271, now a month old; drop once the #425 reversal is final.
- **`pricing_history`** — trigger-written audit trail that nothing reads; write-only with no UI surface.
- **`batch_logs` is mislabeled** — claims status_change/measurement/note but only `"measurement"` is ever written; batch status transitions are not logged anywhere; `log_type` has no CHECK.
- **Naming/pattern drift (document, don't rename):** three near-identical format names (`channel_formats` live, `pricing_channel_formats` dead, `packaging_formats` now a view); two format id-spaces coexist in pricing (`pricing_tier_prices.package_format_id` FKs `package_types` while `order_items` moved to `selling_format_id`); `session_line_items`/`transfer_lines` not parent-prefixed; `location_transfers` are actually bin-to-bin; `additives` catalog ↔ `recipe_additions` junction while `batch_additions` means something else; three integrations use three sync-log/mapping shapes (external-id column named differently in each); money convention is coherent (prices 2dp, costs 4dp) but undocumented; `spices`/`additives` carry duplicate `unit` + `typical_unit` columns.
- **Justified structures (checked, keep):** the 7-way recipe satellite split (a polymorphic collapse would forfeit per-catalog FK integrity), `bin_inventory` vs `bin_inventory_items` layering, `batch_logs`/`brew_logs`/`brew_log_batches` hot/cold split, `yeast_pitches` vs `yeast_pitch_events`, notifications fan-out vs delivery logs, the four pricing tables, `data_integrity_findings` (pg_cron-fed), `entity_revisions` + `_schema_registry` (machine-maintained), shipping-material trio, keg family, purchasing chain.

## Suggested execution order

1. **Zero-risk code fix:** remove the dangling `recipe_variant` relation in `src/entities/batch/core.ts` (H1).
2. **One "drop dead objects" migration branch:** `packages`, `recipe_collaborators`, `pricing_channel_formats` (#724), `vessel_cleanings` (if not building the feature), `recipe_variants` family (pending decision), `_backup_fulfill_past_orders` — each preceded by a live row-count check.
3. **One "registry + FK correction" migration:** `_schema_registry` fermenter fix (M4), notifications FKs (M5), `orders.status` CHECK (M3), `batch_blends` constraints (M6).
4. **One retention pg_cron job** for the six log tables + schedule `cleanup_old_notifications` (H5).
5. **Column-drop audit branch** for M1's list, gated on live-NULL checks and the MongoDB-sync writer check.
6. **Constraint-tightening bundle** (low list), NOT VALID + VALIDATE pattern per 00192.
7. Doc-only: format-id lineage, money precision convention, integration settings/sync-log conventions, yeast duality — in `docs/data-model/`.

All migrations belong in a worktree branch, never on main (repo rule #13).
