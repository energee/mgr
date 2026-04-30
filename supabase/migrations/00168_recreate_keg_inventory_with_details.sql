-- =============================================================================
-- 00168 — Recreate keg_inventory_with_details for selling_formats schema
-- =============================================================================
-- Migration 00155 dropped keg_inventory_with_details and only recreated it
-- inside an `IF keg_types EXISTS` guard. The keg_types table was removed when
-- keg formats were unified into selling_formats / containers, so the view was
-- never recreated. PostgREST returns PGRST205 ("table not found") which surfaces
-- in the UI as "Failed to load keg inventory" on /inventory/kegs.
--
-- This migration rebuilds the view against the current schema:
--   keg_inventory.selling_format_id -> selling_formats -> containers (volume_bbl)
-- =============================================================================

DROP VIEW IF EXISTS keg_inventory_with_details CASCADE;

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
  sf.name           AS keg_type_name,
  c.volume_bbl      AS volume_bbl,
  ko.name           AS keg_owner_name,
  ko.code           AS keg_owner_code,
  l.name            AS location_name,
  b.batch_code      AS batch_code,
  fg_brand.name     AS finished_good_name
FROM keg_inventory ki
JOIN selling_formats sf ON sf.id = ki.selling_format_id
LEFT JOIN containers c ON c.id = sf.container_id
LEFT JOIN keg_owners ko ON ko.id = ki.keg_owner_id
LEFT JOIN locations l ON l.id = ki.location_id
LEFT JOIN batches b ON b.id = ki.batch_id
LEFT JOIN finished_goods fg ON fg.id = ki.finished_good_id
LEFT JOIN brands fg_brand ON fg_brand.id = fg.brand_id;

COMMENT ON VIEW keg_inventory_with_details IS
  'Keg inventory with joined display names (selling_format/container/owner/location/batch/brand).';

-- Refresh PostgREST schema cache so the new view is visible immediately.
NOTIFY pgrst, 'reload schema';
