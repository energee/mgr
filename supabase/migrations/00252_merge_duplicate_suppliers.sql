-- =============================================================================
-- 00252 — merge duplicate suppliers, keep the fullest row, enforce name uniqueness
-- =============================================================================
-- Suppliers were populated by two paths keyed on different ids: the in-app /
-- seed path (random gen_random_uuid v4 ids) and the MongoDB sync
-- (deterministic objectIdToUuid v5 ids). With no uniqueness on name, running
-- the Mongo sync against an already-populated table duplicated the entire
-- catalog (~27 suppliers, each appearing twice) instead of updating in place.
--
-- This migration merges each duplicate group down to ONE row — the one with
-- the most populated optional fields (the import copies carry only name +
-- is_active, so this keeps the richer in-app rows) — repoints the two tables
-- that reference suppliers (purchase_orders, supplier_catalog), deletes the
-- losers, normalizes surviving names, and adds a case-insensitive unique index
-- so it cannot recur.
--
-- Companion code change (src/integrations/mongodb): syncSuppliers now resolves
-- an existing supplier by normalized name and reuses its id, so a re-sync
-- updates the survivor instead of inserting a fresh v5 duplicate (which would
-- otherwise now fail the unique index).
-- =============================================================================

-- 1. Loser -> survivor map. Survivor = most populated optional fields per
--    whitespace-normalized, case-insensitive name; tie-break oldest, then id.
CREATE TEMP TABLE supplier_merge_map AS
WITH scored AS (
  SELECT
    id,
    regexp_replace(btrim(lower(name)), '\s+', ' ', 'g') AS norm,
    ( (contact_name  IS NOT NULL AND btrim(contact_name)  <> '')::int
    + (contact_email IS NOT NULL AND btrim(contact_email) <> '')::int
    + (contact_phone IS NOT NULL AND btrim(contact_phone) <> '')::int
    + (address IS NOT NULL AND address <> '{}'::jsonb)::int
    + (default_lead_time_days IS NOT NULL)::int
    + (payment_terms IS NOT NULL AND btrim(payment_terms) <> '')::int
    + (notes IS NOT NULL AND btrim(notes) <> '')::int
    ) AS score,
    created_at
  FROM suppliers
),
survivors AS (
  SELECT DISTINCT ON (norm) norm, id AS keep_id
  FROM scored
  ORDER BY norm, score DESC, created_at ASC, id ASC
)
SELECT s.id AS loser_id, v.keep_id
FROM scored s
JOIN survivors v ON v.norm = s.norm
WHERE s.id <> v.keep_id;

-- 2. supplier_catalog has UNIQUE(supplier_id, catalog_type, catalog_id).
--    Drop loser rows that would collide with a survivor row, then repoint the
--    rest onto the survivor.
DELETE FROM supplier_catalog sc
USING supplier_merge_map m
WHERE sc.supplier_id = m.loser_id
  AND EXISTS (
    SELECT 1 FROM supplier_catalog keep
    WHERE keep.supplier_id = m.keep_id
      AND keep.catalog_type = sc.catalog_type
      AND keep.catalog_id = sc.catalog_id
  );

UPDATE supplier_catalog sc
SET supplier_id = m.keep_id
FROM supplier_merge_map m
WHERE sc.supplier_id = m.loser_id;

-- 3. purchase_orders -> survivor (no per-supplier uniqueness, straight repoint).
UPDATE purchase_orders po
SET supplier_id = m.keep_id
FROM supplier_merge_map m
WHERE po.supplier_id = m.loser_id;

-- 4. Delete the losing supplier rows.
DELETE FROM suppliers s
USING supplier_merge_map m
WHERE s.id = m.loser_id;

-- 5. Normalize surviving names (collapse internal whitespace, trim) so display
--    is clean and the unique index below is consistent with the merge key.
UPDATE suppliers
SET name = regexp_replace(btrim(name), '\s+', ' ', 'g')
WHERE name <> regexp_replace(btrim(name), '\s+', ' ', 'g');

-- 6. Prevent recurrence: one supplier per case-insensitive name.
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_name_lower_key ON suppliers (lower(name));

DROP TABLE supplier_merge_map;

-- Refresh PostgREST schema cache.
NOTIFY pgrst, 'reload schema';
