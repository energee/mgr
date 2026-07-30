-- MGR Demo Seed Data (Single-Tenant)
--
-- LOCAL ONLY. Applied by `make db-local` (scripts/db-local.sh) AFTER the full
-- migration chain has replayed, and by `make db-seed` (= `supabase db seed`,
-- which also targets the local stack). It runs with admin credentials, so RLS
-- is bypassed. Never point it at the hosted database — see the MAINTENANCE
-- NOTE below for why it cannot apply there.
--
-- Intent: one small, coherent demo brewery — recipes, batches at several
-- statuses, the vessels holding them, packaging containers/formats, packaged
-- product, customers, orders, raw-material inventory with suppliers, plus the
-- reference catalogs (styles, yeasts, malts, hops, ...).
--
-- RE-RUN SAFETY — read this before assuming "idempotent". Safe to re-run
-- against a *freshly reset* database, which is the only case `make db-local`
-- produces. It is NOT generally idempotent, and since the seed is now applied
-- strictly (scripts/db-local.sh, #581) both gaps below are hard failures
-- rather than warnings:
--   * The eight catalog inserts that end in a bare `ON CONFLICT DO NOTHING`
--     (yeasts, malts, hops, sugars, adjuncts, spices, fruits, additives) have
--     no unique constraint anywhere in the chain, so nothing ever conflicts
--     and a second run DUPLICATES every row.
--   * `ON CONFLICT (id) DO NOTHING` only absorbs a repeat of *this* file. A
--     pre-existing row with the same natural key but a different id still
--     raises: vessels.name, containers.name, selling_formats
--     (container_id, name), batches.batch_code, orders.order_number, and
--     suppliers (lower(name), unique since 00252) are all unique.
-- That is deliberate — a natural-key collision fails loudly at the offending
-- statement instead of being skipped and then failing later on a dangling FK.
--
-- MAINTENANCE NOTE (issue #581): this file is written against the schema the
-- migration chain in supabase/migrations/ produces, because that is what
-- `make db-local` replays. It is therefore NOT valid against the hosted
-- database, which dropped these out-of-band (the known chain/live drift):
--   * packages.package_type_id  — NOT NULL in the chain (00001), so it must be
--     supplied here; gone on live, where selling_format_id is NOT NULL instead.
--   * package_types             — superseded by containers + selling_formats
--     (created in 00112, re-stated in 00199), but never dropped by the chain,
--     and still the target of the packages.package_type_id FK on a fresh
--     replay.
-- Columns that are merely nullable-in-chain and absent-on-live are simply
-- omitted, so those statements stay valid against both shapes. The one that
-- matters is batches.fermenter: the chain still creates it (00001) and never
-- drops it, live removed it when vessel occupancy moved to
-- vessels.current_batch_id — see the Vessels section.

-- =============================================================================
-- Update System Settings
-- =============================================================================

UPDATE system_settings SET value = '"Demo Brewing Co"' WHERE key = 'brewery_name';
UPDATE system_settings SET value = '"America/New_York"' WHERE key = 'timezone';
UPDATE system_settings SET value = '10.0' WHERE key = 'default_batch_size_gallons';

-- =============================================================================
-- Recipes
-- =============================================================================

INSERT INTO recipes (id, name, style, description, target_og, target_fg, target_abv, target_ibu, target_srm, batch_size_gallons, boil_time_min)
VALUES
  ('00000000-0000-0000-0001-000000000001',
   'Hazy Days IPA', 'New England IPA', 'Juicy, hazy IPA with tropical hop character',
   1.065, 1.012, 7.0, 45, 5, 10.0, 60),

  ('00000000-0000-0000-0001-000000000002',
   'Midnight Stout', 'American Stout', 'Rich, roasty stout with chocolate notes',
   1.072, 1.018, 7.2, 40, 35, 10.0, 60),

  ('00000000-0000-0000-0001-000000000003',
   'Summer Wheat', 'American Wheat', 'Light, refreshing wheat beer',
   1.048, 1.010, 5.0, 18, 4, 10.0, 60),

  ('00000000-0000-0000-0001-000000000004',
   'Classic Pilsner', 'German Pilsner', 'Crisp, clean lager with noble hop character',
   1.046, 1.008, 5.0, 35, 3, 10.0, 90)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- Batches
-- Note: actual_og and brew_date are now derived from linked brew_logs
-- volume_bbl stores volume in barrels (1 BBL = 31 gallons)
-- batch_number was renamed to batch_code in 00155. Supplying it explicitly
-- short-circuits the generate_batch_code() BEFORE INSERT trigger, which only
-- generates when batch_code is NULL or ''.
-- The free-text `fermenter` column is omitted: it still exists in the chain but
-- is gone on live, and vessel occupancy is carried by vessels.current_batch_id
-- either way — see the Vessels section below.
-- completed_at is set explicitly because its trigger (trg_batches_set_completed_at,
-- 00175) is BEFORE UPDATE only, so a batch inserted straight into 'completed'
-- would keep a NULL — and 00237 buckets TTB removals by completed_at, which
-- would leave the demo's only finished batch missing from those reports.
-- =============================================================================

INSERT INTO batches (id, recipe_id, batch_code, name, status, volume_bbl, planned_start_date, completed_at, actual_fg, actual_abv, notes)
VALUES
  -- Completed batch (10 gal = ~0.32 BBL)
  ('00000000-0000-0000-0002-000000000001',
   '00000000-0000-0000-0001-000000000001', '2024-001', 'Hazy Days #1', 'completed',
   0.32, '2024-12-01', '2024-12-20T00:00:00Z', 1.013, 7.0, 'First batch of our NEIPA. Turned out great!'),

  -- Conditioning batch
  ('00000000-0000-0000-0002-000000000002',
   '00000000-0000-0000-0001-000000000002', '2024-002', 'Midnight Stout #1', 'conditioning',
   0.32, '2024-12-15', NULL, 1.019, 7.3, 'Conditioning for another week.'),

  -- Fermenting batch
  ('00000000-0000-0000-0002-000000000003',
   '00000000-0000-0000-0001-000000000003', '2025-001', 'Summer Wheat #1', 'fermenting',
   0.32, '2025-01-02', NULL, NULL, NULL, 'Fermentation looking healthy.'),

  -- Fermenting batch (was "brewing" but that's not a valid status)
  ('00000000-0000-0000-0002-000000000004',
   '00000000-0000-0000-0001-000000000001', '2025-002', 'Hazy Days #2', 'fermenting',
   0.32, '2025-01-09', NULL, NULL, NULL, 'Fermentation in progress.'),

  -- Planned batch
  ('00000000-0000-0000-0002-000000000005',
   '00000000-0000-0000-0001-000000000004', '2025-003', 'Classic Pilsner #1', 'planned',
   0.32, '2025-01-15', NULL, NULL, NULL, 'Scheduled for next week.')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- Vessels
-- =============================================================================
-- Carries what the batches.fermenter text column used to say. Vessel occupancy
-- is one vessels.current_batch_id per vessel (the column has existed since
-- 00006; 00209 is where the chain records that live dropped the old text
-- column), so FV-1 holds the batch that is *currently* in it (Summer Wheat #1);
-- Hazy Days #1 named FV-1 too but is already completed and out of the tank.
-- location_id is the 'Main Brewery' row seeded by migration 00006.
-- vessels.name is UNIQUE, so these three names must not already exist.

INSERT INTO vessels (id, name, vessel_type, capacity_bbl, location_id, status, current_batch_id, notes)
VALUES
  ('00000000-0000-0000-000b-000000000001', 'FV-1', 'fermenter', 1.00,
   '00000000-0000-0000-0000-000000000002', 'in_use',
   '00000000-0000-0000-0002-000000000003', 'Summer Wheat #1 fermenting.'),
  ('00000000-0000-0000-000b-000000000002', 'FV-2', 'fermenter', 1.00,
   '00000000-0000-0000-0000-000000000002', 'in_use',
   '00000000-0000-0000-0002-000000000002', 'Midnight Stout #1 conditioning.'),
  ('00000000-0000-0000-000b-000000000003', 'FV-3', 'fermenter', 1.00,
   '00000000-0000-0000-0000-000000000002', 'in_use',
   '00000000-0000-0000-0002-000000000004', 'Hazy Days #2 fermenting.')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- Containers (physical container definitions)
-- =============================================================================
-- The real packaging model since the containers/selling_formats refactor
-- (tables created in 00112, re-stated in 00199, registry rows in 00246): a
-- *container* is one physical package (a can, a keg), and a *selling format* is
-- the sellable grouping of them.
--
-- volume_oz is the volume of ONE unit and is required for type='package'
-- (containers_package_needs_oz). Kegs carry volume_bbl instead
-- (containers_keg_needs_bbl) and leave volume_oz NULL; only kegs may carry a
-- non-zero deposit_amount (containers_deposit_keg_only).
--
-- HEADS UP — containers is NOT empty after a chain replay, and containers.name
-- is UNIQUE. Migration 00112 converts every legacy keg_types row (seeded by
-- 00029) into a keg container plus a 'Per Keg' selling format, so a fresh local
-- database already holds '1/2 Barrel', '1/4 Barrel', '1/6 Barrel', '50 Liter',
-- '30 Liter' and 'Corny (5 gal)'. The two keg rows below therefore overlap in
-- substance with '1/2 Barrel' and '1/6 Barrel' and only avoid the unique index
-- by spelling. They are still seeded under their own fixed UUIDs because the
-- 00112 rows inherit keg_types' random ids, which this file cannot reference —
-- but their volume_bbl and deposit_amount are kept identical to the keg_types
-- values so the demo catalog is not self-contradictory. Do not rename these to
-- the keg_types spellings: that would be a unique_violation on the very first
-- bootstrap.

INSERT INTO containers (id, name, type, volume_oz, volume_bbl, deposit_amount, position)
VALUES
  ('00000000-0000-0000-0009-000000000001', '16oz Can', 'package', 16.0, NULL, 0, 10),
  ('00000000-0000-0000-0009-000000000002', '12oz Can', 'package', 12.0, NULL, 0, 20),
  -- Matches keg_types '1/2 Barrel' (0.5 BBL, $30 deposit).
  ('00000000-0000-0000-0009-000000000003', 'Half Barrel Keg', 'keg', NULL, 0.5000, 30.00, 30),
  -- Matches keg_types '1/6 Barrel' (0.1667 BBL, $20 deposit).
  ('00000000-0000-0000-0009-000000000004', 'Sixth Barrel Keg', 'keg', NULL, 0.1667, 20.00, 40)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- Selling Formats (sellable groupings of a container)
-- =============================================================================
-- The single-unit formats keep the original seed's quantity semantics: a
-- packages/order_items quantity counts individual cans or kegs. The
-- 'Case of 24' formats preserve the units_per_case = 24 that the retired
-- package_types rows recorded.
-- Layer geometry (units_per_layer / default_layers) is left NULL, so the
-- compute_pallet_quantity() trigger (00160) leaves pallet_quantity NULL, which
-- in turn makes recalculate_order_materials() (00265, fired by the order_items
-- insert further down) count zero pallets rather than raising.
-- The UNIQUE key is (container_id, name), so reusing 'Single Can' across two
-- containers is fine, and the six 'Per Keg' rows migration 00112 already
-- created hang off different containers entirely.

INSERT INTO selling_formats (id, container_id, name, unit_count, position)
VALUES
  ('00000000-0000-0000-000a-000000000001', '00000000-0000-0000-0009-000000000001', 'Single Can', 1, 10),
  ('00000000-0000-0000-000a-000000000002', '00000000-0000-0000-0009-000000000001', 'Case of 24', 24, 20),
  ('00000000-0000-0000-000a-000000000003', '00000000-0000-0000-0009-000000000002', 'Single Can', 1, 10),
  ('00000000-0000-0000-000a-000000000004', '00000000-0000-0000-0009-000000000002', 'Case of 24', 24, 20),
  ('00000000-0000-0000-000a-000000000005', '00000000-0000-0000-0009-000000000003', 'Single Keg', 1, 10),
  ('00000000-0000-0000-000a-000000000006', '00000000-0000-0000-0009-000000000004', 'Single Keg', 1, 10)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- Package Types (RETIRED — chain-replay only)
-- =============================================================================
-- Superseded by containers + selling_formats above; do not build anything new
-- against this table. It is seeded only because a fresh replay of the migration
-- chain still has packages.package_type_id as NOT NULL REFERENCES
-- package_types(id) (00001), and the hosted database dropped both out-of-band.
-- inner_pack_size / inner_packs_per_case stay NULL so
-- chk_package_units_consistency (00010) is satisfied.

INSERT INTO package_types (id, name, container_type, volume_oz, units_per_case)
VALUES
  ('00000000-0000-0000-0003-000000000001', '16oz Can', 'can', 16.0, 24),
  ('00000000-0000-0000-0003-000000000002', '12oz Can', 'can', 12.0, 24),
  ('00000000-0000-0000-0003-000000000003', 'Half Barrel Keg', 'keg', 1984.0, 1),
  ('00000000-0000-0000-0003-000000000004', 'Sixth Barrel Keg', 'keg', 661.0, 1)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- Packages (packaged products from completed batch)
-- =============================================================================

-- selling_format_id is what the app reads (00159). package_type_id is only
-- supplied because it is still NOT NULL on a fresh chain replay — see the
-- maintenance note at the top of this file. Both point at the same physical
-- container, so the row is consistent whichever column a reader uses.
-- quantity counts individual units, matching the 'Single Can'/'Single Keg'
-- selling formats.

INSERT INTO packages (id, batch_id, package_type_id, selling_format_id, quantity, packaged_date, best_by_date, lot_code)
VALUES
  ('00000000-0000-0000-0004-000000000001',
   '00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0003-000000000001',
   '00000000-0000-0000-000a-000000000001',
   240, '2024-12-20', '2025-03-20', 'HD-2024001-A'),
  ('00000000-0000-0000-0004-000000000002',
   '00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0003-000000000003',
   '00000000-0000-0000-000a-000000000005',
   4, '2024-12-20', '2025-03-20', 'HD-2024001-K')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- Customers
-- =============================================================================

INSERT INTO customers (id, name, customer_type, contact_name, email, phone)
VALUES
  ('00000000-0000-0000-0005-000000000001',
   'Downtown Distributors', 'distributor', 'John Smith', 'john@downtown.dist', '555-0100'),
  ('00000000-0000-0000-0005-000000000002',
   'The Hoppy Place', 'retail', 'Jane Doe', 'jane@hoppyplace.com', '555-0101'),
  ('00000000-0000-0000-0005-000000000003',
   'Craft Corner', 'retail', 'Mike Johnson', 'mike@craftcorner.com', '555-0102')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- Orders
-- =============================================================================

INSERT INTO orders (id, customer_id, order_number, status, order_date, requested_date, notes)
VALUES
  ('00000000-0000-0000-0006-000000000001',
   '00000000-0000-0000-0005-000000000001', 'ORD-2025-001', 'confirmed',
   '2025-01-05', '2025-01-12', 'Monthly restock order'),
  ('00000000-0000-0000-0006-000000000002',
   '00000000-0000-0000-0005-000000000002', 'ORD-2025-002', 'draft',
   '2025-01-08', '2025-01-15', 'New account first order')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- Order Items
-- =============================================================================

-- order_items moved to selling_format_id (00159). package_type_id and
-- keg_type_id are both left NULL, which chk_order_item_format_xor (00080)
-- explicitly allows, and keg_owner_id stays NULL for chk_order_item_keg_owner.
-- unit_price is per individual can/keg, matching the single-unit formats.

INSERT INTO order_items (id, order_id, batch_id, selling_format_id, quantity, unit_price)
VALUES
  ('00000000-0000-0000-0007-000000000001', '00000000-0000-0000-0006-000000000001',
   '00000000-0000-0000-0002-000000000001', '00000000-0000-0000-000a-000000000001', 120, 3.50),
  ('00000000-0000-0000-0007-000000000002', '00000000-0000-0000-0006-000000000001',
   '00000000-0000-0000-0002-000000000001', '00000000-0000-0000-000a-000000000005', 2, 180.00),
  ('00000000-0000-0000-0007-000000000003', '00000000-0000-0000-0006-000000000002',
   '00000000-0000-0000-0002-000000000001', '00000000-0000-0000-000a-000000000001', 48, 4.00)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- Inventory Items
-- =============================================================================

-- The free-text `supplier` column was dropped in 00161; supplier links are now
-- structured rows in supplier_catalog (see the two sections below).
-- `category` is validated against the catalog_type enum registry by the
-- validate_catalog_type trigger (00040), so it must be one of grain, hop,
-- yeast, adjunct, chemical, packaging, equipment, other — note 'hop' is
-- singular (00151 fixed an earlier 'hops' in this very file).

INSERT INTO inventory_items (id, category, name, sku, unit, reorder_point, reorder_qty)
VALUES
  ('00000000-0000-0000-0008-000000000001',
   'grain', 'Pale Malt (2-Row)', 'GRAIN-001', 'lb', 100.0, 500.0),
  ('00000000-0000-0000-0008-000000000002',
   'grain', 'Munich Malt', 'GRAIN-002', 'lb', 50.0, 200.0),
  ('00000000-0000-0000-0008-000000000003',
   'hop', 'Citra Hops', 'HOPS-001', 'oz', 32.0, 64.0),
  ('00000000-0000-0000-0008-000000000004',
   'hop', 'Mosaic Hops', 'HOPS-002', 'oz', 32.0, 64.0),
  ('00000000-0000-0000-0008-000000000005',
   'yeast', 'US-05 Ale Yeast', 'YEAST-001', 'each', 10.0, 20.0),
  ('00000000-0000-0000-0008-000000000006',
   'packaging', '16oz Cans', 'PKG-001', 'case', 20.0, 100.0)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- Suppliers
-- =============================================================================
-- Names must stay distinct case-insensitively: 00252 added the unique index
-- suppliers_name_lower_key on lower(name).

INSERT INTO suppliers (id, name, is_active)
VALUES
  ('00000000-0000-0000-000c-000000000001', 'Midwest Malting', true),
  ('00000000-0000-0000-000c-000000000002', 'Yakima Valley Hops', true),
  ('00000000-0000-0000-000c-000000000003', 'Fermentis', true),
  ('00000000-0000-0000-000c-000000000004', 'Ball Corporation', true)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- Supplier Catalog (supplier -> inventory item links)
-- =============================================================================
-- Replaces the dropped inventory_items.supplier free-text column (00161).
-- catalog_type = 'inventory_item' points catalog_id at an inventory_items row;
-- catalog_id is polymorphic, so there is no FK to enforce it.

INSERT INTO supplier_catalog (id, supplier_id, catalog_type, catalog_id, unit, is_preferred)
VALUES
  ('00000000-0000-0000-000d-000000000001', '00000000-0000-0000-000c-000000000001',
   'inventory_item', '00000000-0000-0000-0008-000000000001', 'lb', true),
  ('00000000-0000-0000-000d-000000000002', '00000000-0000-0000-000c-000000000001',
   'inventory_item', '00000000-0000-0000-0008-000000000002', 'lb', true),
  ('00000000-0000-0000-000d-000000000003', '00000000-0000-0000-000c-000000000002',
   'inventory_item', '00000000-0000-0000-0008-000000000003', 'oz', true),
  ('00000000-0000-0000-000d-000000000004', '00000000-0000-0000-000c-000000000002',
   'inventory_item', '00000000-0000-0000-0008-000000000004', 'oz', true),
  ('00000000-0000-0000-000d-000000000005', '00000000-0000-0000-000c-000000000003',
   'inventory_item', '00000000-0000-0000-0008-000000000005', 'each', true),
  ('00000000-0000-0000-000d-000000000006', '00000000-0000-0000-000c-000000000004',
   'inventory_item', '00000000-0000-0000-0008-000000000006', 'case', true)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- Allocations (inventory movements)
-- =============================================================================
-- NOTE: Allocations table was restructured in migration 00010 to use
-- source_type/source_id and destination_type/destination_id instead of
-- inventory_item_id. Seed data would need inventory_lots created first.
-- Skipping allocation seed data for now.

-- =============================================================================
-- CATALOG DATA: Beer Styles (BJCP 2021 Guidelines)
-- =============================================================================
-- beer_styles has UNIQUE(name), and 00067 already seeds the BJCP list, so most
-- of these rows are absorbed by ON CONFLICT — they are kept so the file also
-- works against a database that predates 00067.

INSERT INTO beer_styles (name, category, og_min, og_max, fg_min, fg_max, ibu_min, ibu_max, srm_min, srm_max, abv_min, abv_max, description)
VALUES
  -- Pale Ales
  ('American Pale Ale', 'Pale Ale', 1.045, 1.060, 1.010, 1.015, 30, 50, 5, 10, 4.5, 6.2, 'Moderate to strong hop aroma and flavor from American hop varieties'),
  ('American IPA', 'IPA', 1.056, 1.070, 1.008, 1.014, 40, 70, 6, 14, 5.5, 7.5, 'Decidedly hoppy and bitter, moderately strong pale ale'),
  ('Hazy IPA', 'IPA', 1.060, 1.085, 1.010, 1.020, 25, 60, 3, 7, 6.0, 9.0, 'Juicy, soft, hazy IPA with tropical fruit hop character'),
  ('West Coast IPA', 'IPA', 1.056, 1.075, 1.008, 1.014, 50, 75, 5, 10, 5.5, 8.0, 'Clean, bitter, dry IPA with resinous/citrus hop character'),
  ('Double IPA', 'IPA', 1.065, 1.100, 1.008, 1.018, 60, 100, 6, 14, 7.5, 10.0, 'Intense hoppy, bitter, alcoholic pale ale'),

  -- Stouts & Porters
  ('American Stout', 'Stout', 1.050, 1.075, 1.010, 1.022, 35, 75, 30, 40, 5.0, 7.0, 'Fairly strong, highly roasted, bitter, hoppy dark stout'),
  ('Imperial Stout', 'Stout', 1.075, 1.115, 1.018, 1.030, 50, 90, 30, 40, 8.0, 12.0, 'Rich, intense, complex, full-bodied stout'),
  ('Oatmeal Stout', 'Stout', 1.045, 1.065, 1.010, 1.018, 25, 40, 22, 40, 4.2, 5.9, 'Dark, roasty, medium-bodied stout with oat smoothness'),
  ('American Porter', 'Porter', 1.050, 1.070, 1.012, 1.018, 25, 50, 22, 40, 4.8, 6.5, 'Substantial, malty dark beer with roasted character'),

  -- Lagers
  ('German Pilsner', 'Lager', 1.044, 1.050, 1.008, 1.013, 25, 45, 2, 5, 4.4, 5.2, 'Crisp, clean, refreshing with noble hop bitterness'),
  ('American Lager', 'Lager', 1.040, 1.050, 1.004, 1.010, 8, 18, 2, 4, 4.2, 5.3, 'Light-bodied, highly carbonated, very well-lagered'),
  ('Munich Helles', 'Lager', 1.044, 1.048, 1.006, 1.012, 16, 22, 3, 5, 4.7, 5.4, 'Malt-accented, clean German lager'),
  ('Oktoberfest/Märzen', 'Lager', 1.054, 1.060, 1.010, 1.014, 20, 28, 8, 17, 5.6, 6.3, 'Rich, malty German amber lager'),

  -- Wheat Beers
  ('American Wheat', 'Wheat', 1.040, 1.055, 1.008, 1.013, 15, 30, 3, 6, 4.0, 5.5, 'Refreshing wheat-based ale with light flavor'),
  ('Hefeweizen', 'Wheat', 1.044, 1.052, 1.010, 1.014, 8, 15, 2, 6, 4.3, 5.6, 'Bavarian wheat ale with banana and clove character'),
  ('Witbier', 'Wheat', 1.044, 1.052, 1.008, 1.012, 8, 20, 2, 4, 4.5, 5.5, 'Belgian wheat ale with coriander and orange peel'),

  -- Belgian
  ('Belgian Blonde', 'Belgian', 1.062, 1.075, 1.008, 1.018, 15, 30, 4, 7, 6.0, 7.5, 'Moderate-strength golden Belgian ale'),
  ('Belgian Tripel', 'Belgian', 1.075, 1.085, 1.008, 1.014, 20, 40, 4.5, 7, 7.5, 9.5, 'Strong, pale, effervescent Belgian ale'),
  ('Saison', 'Belgian', 1.048, 1.065, 1.002, 1.008, 20, 35, 5, 14, 5.0, 7.0, 'Refreshing, fruity, spicy, hoppy farmhouse ale'),

  -- Sours
  ('Berliner Weisse', 'Sour', 1.028, 1.032, 1.003, 1.006, 3, 8, 2, 3, 2.8, 3.8, 'Very pale, refreshing, tart German wheat beer'),
  ('Gose', 'Sour', 1.036, 1.056, 1.006, 1.010, 5, 12, 3, 4, 4.2, 4.8, 'Sour, salty, lightly herbal German wheat beer'),
  ('Flanders Red', 'Sour', 1.048, 1.057, 1.002, 1.012, 10, 25, 10, 17, 4.6, 6.5, 'Complex, sour, wine-like Belgian red ale')
ON CONFLICT (name) DO NOTHING;

-- =============================================================================
-- CATALOG DATA: Yeasts
-- =============================================================================
-- This and the seven catalog blocks that follow end in a bare
-- `ON CONFLICT DO NOTHING`. None of these tables has a unique constraint in the
-- chain, so nothing ever conflicts and a second run duplicates every row —
-- see RE-RUN SAFETY at the top. Only apply them to a freshly reset database.

INSERT INTO yeasts (name, manufacturer, product_code, type, form, attenuation_min, attenuation_max, attenuation_typical, temp_min_f, temp_max_f, temp_ideal_f, flocculation, alcohol_tolerance, description)
VALUES
  -- Dry Ale Yeasts
  ('Safale US-05', 'Fermentis', 'US-05', 'ale', 'dry', 78, 82, 81, 59, 75, 66, 'medium', 12.0, 'Clean American ale yeast. Neutral profile, versatile.'),
  ('Safale S-04', 'Fermentis', 'S-04', 'ale', 'dry', 72, 76, 74, 59, 75, 66, 'high', 11.5, 'English ale yeast. Fruity, fast fermentation.'),
  ('Nottingham', 'Lallemand', 'NOTT', 'ale', 'dry', 73, 82, 77, 57, 70, 64, 'high', 14.0, 'Clean English ale yeast. Neutral, high attenuation option.'),
  ('Belle Saison', 'Lallemand', 'BELLE-S', 'ale', 'dry', 85, 95, 90, 63, 95, 77, 'low', 15.0, 'Belgian saison yeast. Spicy, dry finish.'),
  ('Verdant IPA', 'Lallemand', 'VERD', 'ale', 'dry', 73, 77, 75, 64, 73, 68, 'medium', 10.0, 'Hazy IPA yeast. Biotransformation, low flocculation.'),

  -- Dry Lager Yeasts
  ('Saflager W-34/70', 'Fermentis', 'W-34/70', 'lager', 'dry', 80, 84, 82, 48, 59, 53, 'high', 11.0, 'German lager yeast. Clean, crisp, versatile.'),
  ('Diamond Lager', 'Lallemand', 'DIAM', 'lager', 'dry', 75, 79, 77, 50, 59, 54, 'high', 12.0, 'German lager yeast. Malty, clean profile.'),

  -- Liquid Ale Yeasts (White Labs)
  ('California Ale', 'White Labs', 'WLP001', 'ale', 'liquid', 73, 80, 76, 66, 72, 68, 'medium', 11.0, 'Clean American ale yeast. Most popular craft yeast.'),
  ('English Ale', 'White Labs', 'WLP002', 'ale', 'liquid', 63, 70, 66, 64, 70, 66, 'very_high', 9.0, 'Malty English ale yeast. Leaves residual sweetness.'),
  ('London Ale III', 'White Labs', 'WLP013', 'ale', 'liquid', 71, 75, 73, 64, 72, 68, 'medium', 10.0, 'Fruity English ale yeast. Rich, malty profile.'),
  ('Belgian Wit', 'White Labs', 'WLP400', 'ale', 'liquid', 74, 78, 76, 67, 74, 70, 'low', 10.0, 'Belgian witbier yeast. Slight tartness, spicy.'),
  ('Abbey Ale', 'White Labs', 'WLP530', 'ale', 'liquid', 75, 80, 78, 66, 72, 68, 'medium', 12.0, 'Belgian abbey yeast. Fruity esters, dry finish.'),

  -- Liquid Ale Yeasts (Wyeast)
  ('American Ale', 'Wyeast', '1056', 'ale', 'liquid', 73, 77, 75, 60, 72, 66, 'medium', 11.0, 'Clean fermentation profile. Very versatile.'),
  ('American Ale II', 'Wyeast', '1272', 'ale', 'liquid', 72, 76, 74, 60, 72, 68, 'high', 10.0, 'Slightly nutty and soft ale profile.'),
  ('London ESB', 'Wyeast', '1968', 'ale', 'liquid', 67, 71, 69, 64, 72, 68, 'very_high', 8.0, 'Fruity, malty English ale yeast.'),
  ('Belgian Abbey', 'Wyeast', '1214', 'ale', 'liquid', 74, 78, 76, 68, 78, 72, 'medium', 11.0, 'Abbey-style yeast with complex esters.'),
  ('Belgian Ardennes', 'Wyeast', '3522', 'ale', 'liquid', 72, 76, 74, 65, 85, 75, 'high', 12.0, 'Spicy, clove-like character. Dry finish.'),

  -- Wild/Sour Yeasts
  ('Lacto Blend', 'White Labs', 'WLP677', 'wild', 'liquid', NULL, NULL, NULL, 75, 95, 85, 'low', NULL, 'Lactobacillus blend for kettle souring.'),
  ('Brettanomyces Brux', 'White Labs', 'WLP650', 'wild', 'liquid', NULL, NULL, NULL, 60, 85, 75, 'low', 15.0, 'Brettanomyces for funky sour character.')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- CATALOG DATA: Malts
-- =============================================================================

INSERT INTO malts (name, maltster, country, type, color_lovibond, potential_ppg, max_percentage, requires_mash, diastatic_power, description)
VALUES
  -- Base Malts
  ('2-Row Pale Malt', 'Rahr', 'USA', 'base', 1.8, 37, 100, true, 140, 'American 2-row. Clean base malt for most styles.'),
  ('Pilsner Malt', 'Weyermann', 'Germany', 'base', 1.6, 37, 100, true, 130, 'German pilsner malt. Light color, grainy sweetness.'),
  ('Maris Otter', 'Crisp', 'UK', 'base', 3.0, 38, 100, true, 120, 'English pale malt. Biscuity, rich flavor.'),
  ('Golden Promise', 'Simpsons', 'UK', 'base', 2.5, 37, 100, true, 100, 'Scottish pale malt. Sweet, smooth flavor.'),
  ('Vienna Malt', 'Weyermann', 'Germany', 'base', 3.5, 36, 100, true, 110, 'Adds light toast and orange hue.'),
  ('Munich Malt', 'Weyermann', 'Germany', 'base', 9.0, 36, 80, true, 70, 'German Munich. Rich malt flavor, golden-orange color.'),
  ('Munich Malt II', 'Weyermann', 'Germany', 'base', 9.0, 35, 100, true, 40, 'Darker Munich malt. Biscuity, toasty flavor.'),
  ('Wheat Malt', 'Rahr', 'USA', 'base', 2.0, 38, 70, true, 95, 'White wheat malt. Adds body and head retention.'),

  -- Specialty Malts
  ('Crystal 40', 'Briess', 'USA', 'specialty', 40, 34, 25, false, 0, 'Medium caramel malt. Toffee and caramel flavor.'),
  ('Crystal 60', 'Briess', 'USA', 'specialty', 60, 34, 20, false, 0, 'Medium-dark caramel. More intense caramel.'),
  ('Crystal 80', 'Briess', 'USA', 'specialty', 80, 33, 15, false, 0, 'Dark caramel malt. Rich caramel, slight raisin.'),
  ('Crystal 120', 'Briess', 'USA', 'specialty', 120, 32, 10, false, 0, 'Very dark caramel. Deep caramel, burnt sugar.'),
  ('Honey Malt', 'Gambrinus', 'Canada', 'specialty', 25, 35, 20, false, 0, 'Sweet honey-like flavor. Golden color.'),
  ('Victory Malt', 'Briess', 'USA', 'specialty', 28, 34, 15, true, 0, 'Biscuit character. Light toasted flavor.'),
  ('Biscuit Malt', 'Dingemans', 'Belgium', 'specialty', 23, 35, 15, true, 0, 'Bread crust, biscuit flavor.'),
  ('Aromatic Malt', 'Dingemans', 'Belgium', 'specialty', 20, 35, 15, true, 0, 'Intense malt aroma and flavor.'),
  ('Melanoidin Malt', 'Weyermann', 'Germany', 'specialty', 27, 34, 15, true, 0, 'Enhances malty sweetness and body.'),
  ('Carapils', 'Briess', 'USA', 'specialty', 1.5, 33, 20, false, 0, 'Dextrin malt. Adds body and head retention.'),
  ('Acidulated Malt', 'Weyermann', 'Germany', 'specialty', 1.8, 27, 10, true, 0, 'Lactic acid malt. Lowers mash pH.'),

  -- Roasted Malts
  ('Chocolate Malt', 'Briess', 'USA', 'roasted', 350, 29, 10, false, 0, 'Roasted chocolate flavor. Dark color.'),
  ('Black Malt', 'Briess', 'USA', 'roasted', 500, 28, 5, false, 0, 'Sharp roasted flavor. Deep black color.'),
  ('Roasted Barley', 'Briess', 'USA', 'roasted', 300, 28, 10, false, 0, 'Unmalted barley. Coffee, dry roast character.'),
  ('Carafa II', 'Weyermann', 'Germany', 'roasted', 425, 30, 5, false, 0, 'Dehusked. Smooth dark color without harsh roast.'),
  ('Carafa III', 'Weyermann', 'Germany', 'roasted', 525, 29, 5, false, 0, 'Dehusked. Very dark, coffee-like flavor.'),
  ('Pale Chocolate', 'Simpsons', 'UK', 'roasted', 200, 31, 10, false, 0, 'Lighter chocolate malt. Coffee, nutty flavor.'),

  -- Adjunct Malts
  ('Flaked Oats', 'Briess', 'USA', 'adjunct', 1.0, 32, 30, false, 0, 'Unmalted oats. Silky body, haze in NEIPAs.'),
  ('Flaked Wheat', 'Briess', 'USA', 'adjunct', 1.0, 36, 40, false, 0, 'Unmalted wheat. Haze, body, head retention.'),
  ('Flaked Barley', 'Briess', 'USA', 'adjunct', 1.0, 32, 20, false, 0, 'Unmalted barley. Adds body and creaminess.'),
  ('Flaked Corn', 'Briess', 'USA', 'adjunct', 0.5, 39, 40, false, 0, 'Lightens body and color. American lager adjunct.'),
  ('Flaked Rice', 'Briess', 'USA', 'adjunct', 0.5, 40, 40, false, 0, 'Very light, neutral. Lightens body.'),
  ('Torrified Wheat', 'Simpsons', 'UK', 'adjunct', 1.5, 36, 40, false, 0, 'Puffed wheat. Head retention and body.')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- CATALOG DATA: Hops
-- =============================================================================

INSERT INTO hops (name, origin, type, alpha_acid_min, alpha_acid_max, alpha_acid_typical, beta_acid_min, beta_acid_max, flavor_profile, substitutes)
VALUES
  -- American Hops
  ('Citra', 'USA', 'dual', 11.0, 13.0, 12.0, 3.5, 4.5, 'Tropical, citrus, mango, grapefruit', 'Galaxy, Mosaic, Amarillo'),
  ('Mosaic', 'USA', 'dual', 11.5, 13.5, 12.5, 3.2, 3.9, 'Complex tropical, berry, citrus, earthy', 'Citra, Simcoe, Amarillo'),
  ('Simcoe', 'USA', 'dual', 12.0, 14.0, 13.0, 4.0, 5.0, 'Pine, citrus, earthy, berry', 'Mosaic, Columbus, Centennial'),
  ('Amarillo', 'USA', 'aroma', 8.0, 11.0, 9.5, 6.0, 7.0, 'Orange citrus, floral, tropical', 'Cascade, Centennial, Citra'),
  ('Centennial', 'USA', 'dual', 9.5, 11.5, 10.5, 3.5, 4.5, 'Floral, citrus, medium intensity', 'Cascade, Columbus, Amarillo'),
  ('Cascade', 'USA', 'aroma', 4.5, 7.0, 5.5, 4.8, 7.0, 'Grapefruit, floral, spicy', 'Centennial, Amarillo, Columbus'),
  ('Columbus', 'USA', 'bittering', 14.0, 16.0, 15.0, 4.5, 5.5, 'Dank, herbal, citrus, earthy', 'Simcoe, Chinook, Centennial'),
  ('Chinook', 'USA', 'dual', 12.0, 14.0, 13.0, 3.0, 4.0, 'Pine, grapefruit, spicy', 'Columbus, Simcoe, Nugget'),
  ('Galaxy', 'Australia', 'dual', 13.0, 15.0, 14.0, 5.6, 6.5, 'Passionfruit, peach, citrus', 'Citra, Nelson Sauvin'),
  ('Nelson Sauvin', 'New Zealand', 'dual', 12.0, 13.0, 12.5, 6.0, 8.0, 'White wine, gooseberry, tropical', 'Galaxy, Motueka'),
  ('Idaho 7', 'USA', 'dual', 13.0, 17.0, 15.0, 4.5, 5.5, 'Tropical, stone fruit, pine, dank', 'Mosaic, Simcoe, Citra'),
  ('El Dorado', 'USA', 'dual', 14.0, 16.0, 15.0, 7.0, 8.0, 'Tropical, candy, watermelon', 'Mosaic, Citra, Galaxy'),
  ('Sabro', 'USA', 'dual', 14.0, 17.0, 15.5, 4.0, 5.0, 'Coconut, tropical, citrus, stone fruit', 'Mosaic, Galaxy'),
  ('Strata', 'USA', 'dual', 11.0, 14.0, 12.5, 4.0, 5.5, 'Passion fruit, hemp, citrus, grapefruit', 'Mosaic, Galaxy'),
  ('Talus', 'USA', 'dual', 10.0, 12.0, 11.0, 6.5, 8.0, 'Pink grapefruit, rose, sage', 'Centennial, Citra'),

  -- European Noble Hops
  ('Saaz', 'Czech Republic', 'aroma', 2.5, 4.5, 3.5, 4.0, 6.0, 'Spicy, floral, earthy', 'Tettnang, Hallertau Mittelfrueh'),
  ('Tettnang', 'Germany', 'aroma', 3.5, 5.0, 4.5, 3.5, 4.5, 'Spicy, floral, slightly citrus', 'Saaz, Hallertau'),
  ('Hallertau Mittelfrueh', 'Germany', 'aroma', 3.0, 5.5, 4.0, 3.0, 5.0, 'Floral, spicy, earthy', 'Tettnang, Saaz'),
  ('Perle', 'Germany', 'dual', 6.0, 9.0, 7.5, 3.5, 4.5, 'Slightly spicy, floral, minty', 'Northern Brewer, Hallertau'),
  ('Magnum', 'Germany', 'bittering', 12.0, 14.0, 13.0, 4.5, 5.5, 'Clean bittering, neutral', 'German Northern Brewer'),
  ('Mandarina Bavaria', 'Germany', 'aroma', 7.0, 10.0, 8.5, 5.0, 6.5, 'Tangerine, citrus, sweet', 'Cascade, Centennial'),

  -- English Hops
  ('East Kent Goldings', 'UK', 'aroma', 4.0, 5.5, 5.0, 2.0, 3.5, 'Floral, spicy, honey', 'Fuggle, Styrian Goldings'),
  ('Fuggle', 'UK', 'aroma', 4.0, 5.5, 4.5, 1.5, 2.5, 'Earthy, woody, mild', 'East Kent Goldings, Willamette'),
  ('Challenger', 'UK', 'dual', 6.0, 8.5, 7.0, 3.0, 4.0, 'Spicy, cedar, green tea', 'Northern Brewer, Perle'),

  -- Bittering Hops
  ('Nugget', 'USA', 'bittering', 12.0, 14.0, 13.0, 4.0, 6.0, 'Heavy herbal, slightly floral', 'Columbus, Magnum'),
  ('Warrior', 'USA', 'bittering', 15.0, 17.0, 16.0, 4.5, 5.5, 'Clean bittering, mild citrus', 'Columbus, Magnum')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- CATALOG DATA: Sugars
-- =============================================================================

INSERT INTO sugars (name, type, color_lovibond, potential_ppg, fermentability, description)
VALUES
  ('Corn Sugar (Dextrose)', 'simple', 0, 46, 100, 'Highly fermentable. Lightens body, raises ABV.'),
  ('Table Sugar (Sucrose)', 'simple', 0, 46, 100, 'Fully fermentable. Lightens body.'),
  ('Candi Sugar (Clear)', 'invert', 0, 40, 100, 'Belgian clear candi. Ferments completely.'),
  ('Candi Sugar (Dark)', 'invert', 90, 38, 100, 'Belgian dark candi. Adds raisin, caramel, plum.'),
  ('Candi Syrup D-90', 'invert', 90, 32, 95, 'Dark Belgian syrup. Rich dark fruit, toffee.'),
  ('Candi Syrup D-180', 'invert', 180, 32, 95, 'Very dark Belgian syrup. Intense dark fruit.'),
  ('Honey', 'honey', 3, 35, 95, 'Adds floral sweetness and complexity.'),
  ('Maple Syrup', 'maple', 35, 30, 90, 'Grade A maple syrup. Adds distinctive maple character.'),
  ('Brown Sugar', 'simple', 15, 44, 100, 'Adds light molasses character.'),
  ('Molasses', 'molasses', 80, 36, 85, 'Strong molasses flavor. Use sparingly.'),
  ('Rice Syrup', 'simple', 0, 32, 70, 'Lightens body. Neutral flavor.'),
  ('Lactose', 'simple', 0, 35, 0, 'Unfermentable. Adds sweetness and body.')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- CATALOG DATA: Adjuncts
-- =============================================================================

INSERT INTO adjuncts (name, type, color_lovibond, potential_ppg, requires_mash, description)
VALUES
  ('Rice Hulls', 'other', 0, 0, false, 'Improves lautering. No flavor contribution.'),
  ('Corn (Maize)', 'grain', 0.5, 39, true, 'Lightens body and flavor. American lager adjunct.'),
  ('Rice', 'grain', 0.5, 40, true, 'Very light, neutral. Asian lagers.'),
  ('Rye (Flaked)', 'grain', 2.0, 36, true, 'Spicy character. Adds complexity to body.'),
  ('Rye Malt', 'grain', 3.5, 35, true, 'Malted rye. Spicy, slightly sweet.')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- CATALOG DATA: Spices
-- =============================================================================

INSERT INTO spices (name, type, description, typical_amount, typical_unit)
VALUES
  ('Coriander Seed', 'spice', 'Citrusy, peppery. Essential for witbier.', 1.0, 'oz'),
  ('Orange Peel (Bitter)', 'botanical', 'Bitter citrus. Common in Belgian wits.', 0.5, 'oz'),
  ('Orange Peel (Sweet)', 'botanical', 'Sweeter citrus peel.', 0.5, 'oz'),
  ('Chamomile', 'herb', 'Floral, apple-like. Relaxing character.', 0.25, 'oz'),
  ('Ginger', 'spice', 'Spicy, warming. Fresh or dried.', 0.5, 'oz'),
  ('Cinnamon', 'spice', 'Warm spice. Common in winter warmers.', 0.25, 'oz'),
  ('Vanilla Bean', 'spice', 'Sweet, creamy vanilla. Use whole beans.', 2.0, 'each'),
  ('Coffee (Whole Bean)', 'botanical', 'Coffee character. Add post-fermentation.', 2.0, 'oz'),
  ('Cocoa Nibs', 'botanical', 'Chocolate character without sweetness.', 4.0, 'oz'),
  ('Star Anise', 'spice', 'Licorice flavor. Use sparingly.', 2.0, 'each'),
  ('Juniper Berries', 'botanical', 'Piney, gin-like flavor.', 0.5, 'oz'),
  ('Hibiscus', 'botanical', 'Tart, cranberry-like. Pink/red color.', 1.0, 'oz'),
  ('Cardamom', 'spice', 'Warm, citrusy spice.', 0.25, 'oz'),
  ('Black Pepper', 'spice', 'Spicy heat. Common in saisons.', 0.25, 'oz'),
  ('Grains of Paradise', 'spice', 'Peppery, citrusy. African spice.', 0.25, 'oz'),
  ('Rose Hips', 'botanical', 'Tart, floral. Vitamin C source.', 0.5, 'oz'),
  ('Lemongrass', 'herb', 'Bright citrus character.', 0.5, 'oz'),
  ('Thai Basil', 'herb', 'Anise-like, herbal character.', 0.5, 'oz')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- CATALOG DATA: Fruits
-- =============================================================================

INSERT INTO fruits (name, type, form, sugar_content, description)
VALUES
  ('Passion Fruit', 'puree', 'frozen', 14.0, 'Tropical, tart. Popular in sours and IPAs.'),
  ('Mango', 'puree', 'aseptic', 16.0, 'Sweet tropical. Pairs well with hops.'),
  ('Raspberry', 'puree', 'frozen', 10.0, 'Tart berry. Classic for fruit beers.'),
  ('Strawberry', 'puree', 'frozen', 8.0, 'Sweet berry. Delicate flavor.'),
  ('Blackberry', 'puree', 'frozen', 10.0, 'Dark berry. Rich, jammy character.'),
  ('Blueberry', 'puree', 'frozen', 10.0, 'Subtle berry. Adds color and mild flavor.'),
  ('Cherry (Tart)', 'puree', 'frozen', 12.0, 'Sour cherry. Classic for krieks.'),
  ('Cherry (Sweet)', 'puree', 'frozen', 16.0, 'Sweet cherry character.'),
  ('Peach', 'puree', 'aseptic', 12.0, 'Stone fruit. Great in wheat beers.'),
  ('Apricot', 'puree', 'aseptic', 12.0, 'Stone fruit. Subtle, complex.'),
  ('Pineapple', 'puree', 'aseptic', 13.0, 'Tropical, bright. Can be aggressive.'),
  ('Guava', 'puree', 'aseptic', 12.0, 'Tropical, musky. Unique character.'),
  ('Blood Orange', 'juice', 'fresh', 11.0, 'Citrus with berry notes.'),
  ('Grapefruit', 'juice', 'fresh', 10.0, 'Bitter citrus. Pairs with hops.'),
  ('Lemon', 'juice', 'fresh', 8.0, 'Bright, tart citrus.'),
  ('Lime', 'juice', 'fresh', 8.0, 'Sharp, tart citrus.'),
  ('Coconut (Toasted)', 'dried', 'dried', 6.0, 'Sweet, tropical. Use toasted flakes.')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- CATALOG DATA: Additives (Water Salts, Clarifiers, etc.)
-- =============================================================================

INSERT INTO additives (name, type, description, typical_amount, typical_unit)
VALUES
  -- Water Salts
  ('Gypsum (CaSO4)', 'water_salt', 'Calcium sulfate. Enhances hop bitterness.', 5.0, 'g'),
  ('Calcium Chloride (CaCl2)', 'water_salt', 'Enhances malt character and fullness.', 5.0, 'g'),
  ('Epsom Salt (MgSO4)', 'water_salt', 'Magnesium sulfate. Adds dry minerality.', 2.0, 'g'),
  ('Baking Soda (NaHCO3)', 'water_salt', 'Sodium bicarbonate. Raises pH.', 2.0, 'g'),
  ('Chalk (CaCO3)', 'water_salt', 'Calcium carbonate. Raises pH for dark beers.', 3.0, 'g'),
  ('Table Salt (NaCl)', 'water_salt', 'Enhances flavor. Use sparingly.', 1.0, 'g'),

  -- Acids
  ('Lactic Acid 88%', 'acid', 'Lowers mash/sparge pH. Minimal flavor.', 2.0, 'mL'),
  ('Phosphoric Acid 10%', 'acid', 'Lowers pH. Very neutral flavor.', 5.0, 'mL'),
  ('Citric Acid', 'acid', 'Adds tartness. Use in sours/kettle sours.', 2.0, 'g'),

  -- Clarifiers
  ('Whirlfloc', 'clarifier', 'Irish moss tablet. Add at 10min.', 1.0, 'tablet'),
  ('Irish Moss', 'clarifier', 'Traditional kettle fining. Add at 15min.', 1.0, 'tsp'),
  ('Gelatin', 'clarifier', 'Post-fermentation fining. Very effective.', 0.5, 'tsp'),
  ('Biofine Clear', 'clarifier', 'Vegan post-fermentation fining.', 15.0, 'mL'),
  ('PVPP (Polyclar)', 'clarifier', 'Removes polyphenols. Improves stability.', 2.0, 'g'),

  -- Nutrients
  ('Yeast Nutrient', 'nutrient', 'DAP-based nutrient. Add at 10min.', 1.0, 'tsp'),
  ('Fermaid-O', 'nutrient', 'Organic yeast nutrient. No DAP.', 6.0, 'g'),
  ('Fermaid-K', 'nutrient', 'Complete yeast nutrient blend.', 6.0, 'g'),
  ('Zinc Sulfate', 'nutrient', 'Zinc supplement for yeast health.', 1.0, 'mg'),

  -- Enzymes
  ('Amylase Enzyme', 'enzyme', 'Converts starches. Brut IPA, dry beers.', 1.0, 'tsp'),
  ('Clarity Ferm', 'enzyme', 'Reduces gluten. Also clarifies.', 2.5, 'mL'),
  ('Pectinase', 'enzyme', 'Breaks down pectin. Use with fruit.', 0.5, 'tsp'),

  -- Other
  ('Anti-Foam', 'antifoam', 'Prevents boil-over. Use sparingly.', 2.0, 'drops'),
  ('Campden Tablet', 'other', 'Removes chlorine/chloramine from water.', 1.0, 'tablet'),
  ('Potassium Sorbate', 'other', 'Prevents refermentation. For back-sweetening.', 1.0, 'g')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- CATALOG DATA: Water Profiles
-- =============================================================================

INSERT INTO water_profiles (name, calcium_ppm, magnesium_ppm, sodium_ppm, sulfate_ppm, chloride_ppm, bicarbonate_ppm, description)
VALUES
  ('RO/Distilled', 0, 0, 0, 0, 0, 0, 'Blank slate. Build up from scratch.'),
  ('Burton-on-Trent', 275, 40, 25, 610, 36, 260, 'High sulfate English water. Classic for IPAs.'),
  ('Dublin', 118, 4, 12, 54, 19, 319, 'High bicarbonate. Good for stouts.'),
  ('London', 52, 16, 86, 32, 34, 104, 'Moderate mineral content. English ales.'),
  ('Munich', 75, 18, 2, 10, 2, 152, 'Low mineral with bicarbonate. German lagers.'),
  ('Pilsen', 7, 2, 2, 5, 5, 14, 'Very soft water. Bohemian pilsners.'),
  ('Vienna', 200, 60, 8, 125, 12, 120, 'Moderate minerals. Vienna lagers, märzens.'),
  ('Dortmund', 250, 25, 40, 120, 106, 220, 'Balanced high mineral. Export lagers.'),

  -- Modern Brewing Profiles
  ('Hoppy (Yellow)', 50, 5, 10, 150, 50, 0, 'High sulfate:chloride ratio. Crisp hop bite.'),
  ('Balanced', 50, 5, 10, 75, 75, 0, '1:1 sulfate:chloride. Balanced character.'),
  ('Malty (Full)', 50, 5, 10, 50, 150, 0, 'High chloride:sulfate. Round, malty body.'),
  ('Hazy IPA', 75, 5, 20, 100, 150, 0, 'Higher chloride for soft mouthfeel, moderate sulfate.'),
  ('Lager', 40, 5, 5, 30, 30, 50, 'Light mineral content. Clean lager character.'),
  ('Stout/Porter', 100, 15, 50, 50, 100, 200, 'Higher bicarbonate for dark malt acidity.')
ON CONFLICT (name) DO NOTHING;

SELECT 'Seed data created (including catalog data)!' AS message;
