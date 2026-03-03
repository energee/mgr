-- =============================================================================
-- Fix keg_inventory view: replace gen_random_uuid() with deterministic ID
-- =============================================================================
-- The keg_inventory view used gen_random_uuid() for the id column, meaning
-- every query returned different IDs for the same rows. This broke detail
-- page routing since /inventory/kegs/[id] could never refetch the same row.
--
-- Fix: derive a stable UUID from the grouping-key columns via md5().

-- Drop dependent views first
DROP VIEW IF EXISTS keg_inventory_with_details CASCADE;
DROP VIEW IF EXISTS keg_inventory_summary CASCADE;
DROP VIEW IF EXISTS keg_inventory CASCADE;

-- Recreate keg_inventory with deterministic ID
CREATE VIEW keg_inventory
WITH (security_invoker = true)
AS
WITH inflows AS (
  SELECT
    selling_format_id,
    keg_owner_id,
    to_state AS state,
    to_location_id AS location_id,
    batch_id,
    finished_good_id,
    SUM(quantity) AS qty
  FROM keg_transactions
  GROUP BY selling_format_id, keg_owner_id, to_state, to_location_id, batch_id, finished_good_id
),
outflows AS (
  SELECT
    selling_format_id,
    keg_owner_id,
    from_state AS state,
    from_location_id AS location_id,
    batch_id,
    finished_good_id,
    SUM(quantity) AS qty
  FROM keg_transactions
  WHERE from_state IS NOT NULL
  GROUP BY selling_format_id, keg_owner_id, from_state, from_location_id, batch_id, finished_good_id
),
combined AS (
  SELECT
    selling_format_id,
    keg_owner_id,
    state,
    location_id,
    batch_id,
    finished_good_id,
    COALESCE(SUM(qty), 0) AS quantity
  FROM (
    SELECT selling_format_id, keg_owner_id, state, location_id, batch_id, finished_good_id, qty FROM inflows
    UNION ALL
    SELECT selling_format_id, keg_owner_id, state, location_id, batch_id, finished_good_id, -qty FROM outflows
  ) sub
  GROUP BY selling_format_id, keg_owner_id, state, location_id, batch_id, finished_good_id
  HAVING COALESCE(SUM(qty), 0) > 0
)
SELECT
  md5(
    COALESCE(selling_format_id::text, '') || ':' ||
    COALESCE(keg_owner_id::text, '') || ':' ||
    COALESCE(state::text, '') || ':' ||
    COALESCE(location_id::text, '') || ':' ||
    COALESCE(batch_id::text, '') || ':' ||
    COALESCE(finished_good_id::text, '')
  )::uuid AS id,
  selling_format_id,
  keg_owner_id,
  state::keg_state,
  location_id,
  quantity::INTEGER,
  batch_id,
  finished_good_id
FROM combined;

-- Recreate keg_inventory_with_details
CREATE VIEW keg_inventory_with_details
WITH (security_invoker = true)
AS
SELECT
  ki.id,
  ki.selling_format_id,
  ki.keg_owner_id,
  ki.state,
  ki.location_id,
  ki.quantity,
  ki.batch_id,
  ki.finished_good_id,
  c.name AS keg_type_name,
  c.volume_bbl,
  ko.name AS keg_owner_name,
  ko.code AS keg_owner_code,
  l.name AS location_name,
  b.batch_number,
  fg.lot_number AS finished_good_name
FROM keg_inventory ki
LEFT JOIN selling_formats sf ON sf.id = ki.selling_format_id
LEFT JOIN containers c ON c.id = sf.container_id
LEFT JOIN keg_owners ko ON ko.id = ki.keg_owner_id
LEFT JOIN locations l ON l.id = ki.location_id
LEFT JOIN batches b ON b.id = ki.batch_id
LEFT JOIN finished_goods fg ON fg.id = ki.finished_good_id;

-- Recreate keg_inventory_summary
CREATE VIEW keg_inventory_summary
WITH (security_invoker = true)
AS
SELECT
  sf.id AS selling_format_id,
  c.name AS keg_type_name,
  c.volume_bbl,
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state = 'empty'), 0) AS empty_count,
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state = 'filled'), 0) AS filled_count,
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state = 'shipped'), 0) AS shipped_count,
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state = 'returned_dirty'), 0) AS dirty_count,
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state = 'cleaning'), 0) AS cleaning_count,
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state = 'maintenance'), 0) AS maintenance_count,
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state = 'retired'), 0) AS retired_count,
  COALESCE(SUM(ki.quantity), 0) AS total_count
FROM selling_formats sf
JOIN containers c ON c.id = sf.container_id AND c.type = 'keg'
LEFT JOIN keg_inventory ki ON sf.id = ki.selling_format_id
GROUP BY sf.id, c.name, c.volume_bbl
ORDER BY c.volume_bbl DESC NULLS LAST;
