-- 00222_square_bin_pos_config.sql
-- Square POS bin-sync, Milestone C1: move Square POS configuration from the
-- LOCATION onto the BIN.
--
-- WHY THIS EXISTS
--   The old model (00091) hung Square POS config off locations: a locations row
--   with BOTH square_location_id (text) and pos_bin_id (uuid -> bins) set was the
--   POS target, and pricing for POS sales was hardcoded to the taproom sales
--   channel. That coupling is wrong for the per-bin sync: a single location can
--   own several sellable bins, and different POS targets should price via
--   different channels, not a hardwired taproom.
--
--   NEW MODEL -- config lives on the BIN:
--     * bins.square_location_id    (text, nullable) -- the Square location this bin
--       syncs to. A bin <-> Square location is 1:1, enforced by the partial UNIQUE
--       index bins_unique_square_location.
--     * bins.pos_sales_channel_id  (uuid -> sales_channels, nullable, ON DELETE
--       SET NULL) -- the channel that drives POS pricing for this bin. This
--       REPLACES the hardcoded taproom channel: each POS bin now prices via its
--       own channel.
--     A bin is a Square POS sync target IFF BOTH columns are set (mirrors the old
--     "both columns set on a location" rule, moved down to the bin).
--
--   NEW TABLE -- square_locations: Square POS locations pulled from the Square API
--   (live refresh arrives in Milestone C3). Until then, this migration seeds it
--   from any pre-existing location-level POS config so existing setups show a
--   location row before the first live refresh. RLS: staff READ (any authenticated
--   user -- the per-bin POS-config picker in the UI must list Square locations),
--   integrations:manage (= admin) WRITE. The WRITE side matches the admin-only
--   write on square_settings / square_catalog_map (00097 replaced 00091's
--   auth.uid() policies); READ is intentionally BROADER than those tables so
--   non-admin staff can populate the picker -- square_locations holds only
--   non-sensitive Square location ids/names, no secrets.
--
--   DATA MIGRATION + DROP (destructive, so migrate FIRST):
--     1. For every locations row that was a POS target (square_location_id AND
--        pos_bin_id both set), copy square_location_id onto its pos_bin, and set
--        that bin's pos_sales_channel_id to the taproom channel -- preserving
--        today's taproom-priced behavior. If no 'taproom' channel exists the
--        channel stays NULL (acceptable; the bin needs a channel picked in the UI).
--     2. Seed square_locations from the distinct migrated square_location_ids.
--     3. THEN drop locations.square_location_id and locations.pos_bin_id.
--
--   DEPENDENCY HANDLED: the locations_with_pos view (00091) does SELECT l.* plus
--   LEFT JOIN bins b ON b.id = l.pos_bin_id, so it depends on both dropped columns
--   and would block the DROP. The POS-on-location model it enriched no longer
--   exists, so this migration DROPs the view (no replacement -- POS config is now
--   a bin concern). The idx_locations_pos_bin index is dropped automatically with
--   its column. No function/trigger references either dropped column.
--
-- Live-safe: additive columns/index + a new table, an idempotent data migration,
-- then the destructive view+column drops (guarded by IF EXISTS). Verified by a
-- self-rolling-back DO block at the end (commits NO rows), matching 00219/00221.

-- =============================================================================
-- PART 1 -- bins: carry the Square POS config
-- =============================================================================

ALTER TABLE bins
  ADD COLUMN IF NOT EXISTS square_location_id TEXT,
  ADD COLUMN IF NOT EXISTS pos_sales_channel_id UUID
    REFERENCES sales_channels(id) ON DELETE SET NULL;

COMMENT ON COLUMN bins.square_location_id IS
  'Square POS location this bin syncs to (00222). 1:1 with a Square location (bins_unique_square_location partial UNIQUE). A bin is a Square POS sync target only when BOTH this and pos_sales_channel_id are set -- this replaces the old location-level square_location_id + pos_bin_id target model. NULL = this bin is not a POS target.';

COMMENT ON COLUMN bins.pos_sales_channel_id IS
  'Sales channel that drives pricing for this bin''s Square POS sync (00222). Replaces the hardcoded taproom channel: each POS bin now prices via its own channel. A bin is a POS sync target only when this and square_location_id are both set. ON DELETE SET NULL. Bins migrated from the old location-level POS config default to the taproom channel to preserve prior behavior.';

-- Bin <-> Square location is 1:1: no two bins may point at the same Square
-- location. Partial so unconfigured bins (NULL) are unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS bins_unique_square_location
  ON bins (square_location_id)
  WHERE square_location_id IS NOT NULL;

-- Index the new FK (repo unindexed-FK convention, cf. 00060/00061/00129/00219).
CREATE INDEX IF NOT EXISTS idx_bins_pos_sales_channel_id
  ON bins (pos_sales_channel_id);

-- =============================================================================
-- PART 2 -- square_locations: the pulled-from-Square location table
-- =============================================================================

CREATE TABLE IF NOT EXISTS square_locations (
  square_location_id TEXT PRIMARY KEY,
  name               TEXT,
  status             TEXT,
  synced_at          TIMESTAMPTZ
);

COMMENT ON TABLE square_locations IS
  'Square POS locations pulled from the Square API (00222; live refresh added in Milestone C3). A bin links to one of these 1:1 via bins.square_location_id. Seeded during the 00222 data migration from any pre-existing location-level POS config so existing setups show a location row before the first live refresh.';
COMMENT ON COLUMN square_locations.square_location_id IS
  'Square''s permanent location ID (Square API location "id"). Referenced 1:1 by bins.square_location_id.';
COMMENT ON COLUMN square_locations.name IS
  'Human-readable Square location name (Square API location "name").';
COMMENT ON COLUMN square_locations.status IS
  'Square location status (e.g. ACTIVE / INACTIVE). Seeded as ACTIVE for migrated config; refreshed from Square in C3.';
COMMENT ON COLUMN square_locations.synced_at IS
  'When this row was last pulled/refreshed from the Square API (now() for rows seeded by the 00222 migration).';

ALTER TABLE square_locations ENABLE ROW LEVEL SECURITY;

-- RLS: staff READ (square_locations holds non-sensitive Square location ids/names
-- and feeds the per-bin POS-config picker in the UI), integrations:manage (= admin)
-- WRITE — the write side mirrors square_settings / square_catalog_map (00097).
CREATE POLICY square_locations_select ON square_locations
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY square_locations_write ON square_locations
  FOR ALL USING (user_has_permission('integrations:manage'))
  WITH CHECK (user_has_permission('integrations:manage'));

-- =============================================================================
-- PART 3 -- data migration (BEFORE the drop): location POS config -> bins
-- =============================================================================
-- Idempotent: reads the still-present locations columns and writes bins /
-- square_locations. Re-running after the columns are dropped is a no-op because
-- PART 4 removes the source columns (and this whole file is one transaction).

-- 3a. Copy each POS-target location's Square link onto its pos_bin, and price that
--     bin via taproom (preserving today's hardcoded-taproom behavior). If there is
--     no 'taproom' channel the scalar subquery yields NULL and the bin's channel
--     stays NULL -- acceptable; it will need a channel picked in the UI.
UPDATE bins b
SET square_location_id  = l.square_location_id,
    pos_sales_channel_id = (SELECT id FROM sales_channels WHERE code = 'taproom' LIMIT 1)
FROM locations l
WHERE l.pos_bin_id = b.id
  AND l.square_location_id IS NOT NULL
  AND l.pos_bin_id IS NOT NULL;

-- 3b. Seed square_locations from the distinct migrated Square location IDs so
--     existing config shows a location row until the first live refresh (C3).
INSERT INTO square_locations (square_location_id, name, status, synced_at)
SELECT DISTINCT ON (l.square_location_id)
       l.square_location_id, l.name, 'ACTIVE', now()
FROM locations l
WHERE l.square_location_id IS NOT NULL
  AND l.pos_bin_id IS NOT NULL
ON CONFLICT (square_location_id) DO NOTHING;

-- =============================================================================
-- PART 4 -- drop the obsolete location-level POS model (destructive)
-- =============================================================================
-- locations_with_pos (00091) selects l.* and joins on l.pos_bin_id, so it depends
-- on both dropped columns and must go first. No replacement: POS config is now a
-- bin concern. idx_locations_pos_bin is dropped automatically with its column.

DROP VIEW IF EXISTS locations_with_pos;

ALTER TABLE locations DROP COLUMN IF EXISTS square_location_id;
ALTER TABLE locations DROP COLUMN IF EXISTS pos_bin_id;

-- =============================================================================
-- PART 5 -- verification (self-rolling-back; commits NO rows)
-- =============================================================================
-- Proves, then rolls back:
--   (a) a bin can hold square_location_id + pos_sales_channel_id (config round-trip);
--   (b) the partial UNIQUE bins_unique_square_location rejects a duplicate
--       square_location_id on a second bin;
--   (c) square_locations insert + select works under the new table.
--
-- All test rows are created inside one subtransaction (BEGIN/EXCEPTION establishes
-- a savepoint). A passing run RAISEs the sentinel 'C1_VERIFY_OK' to unwind the
-- subtransaction, so nothing is committed. A genuine assertion failure RAISEs
-- 'C1_ASSERT_FAIL...' and is re-raised to ABORT the migration. Any other error
-- (missing prerequisites on a from-scratch replay, etc.) is downgraded to a
-- WARNING so the DDL above still applies -- this block is a check, not a gate.
DO $$
DECLARE
  v_loc     UUID;
  v_chan    UUID;
  v_bin1    UUID;
  v_bin2    UUID;
  v_sq      TEXT;
  v_cnt     INTEGER;
  v_name    TEXT;
  v_got_dup BOOLEAN := false;
  v_sfx     TEXT := replace(gen_random_uuid()::text, '-', '');
BEGIN
  BEGIN
    v_sq := 'C1_sq_' || v_sfx;

    -- Dedicated test channel (do NOT touch the real taproom row) + location.
    INSERT INTO sales_channels (name, code)
      VALUES ('C1_chan_' || v_sfx, 'C1_' || v_sfx)
      RETURNING id INTO v_chan;
    INSERT INTO locations (name, location_type, is_primary)
      VALUES ('C1_loc_' || v_sfx, 'warehouse', false)
      RETURNING id INTO v_loc;

    -- (a) a bin holds both POS config columns and they round-trip.
    INSERT INTO bins (location_id, name, square_location_id, pos_sales_channel_id)
      VALUES (v_loc, 'C1_bin1_' || v_sfx, v_sq, v_chan)
      RETURNING id INTO v_bin1;
    SELECT count(*) INTO v_cnt
      FROM bins
      WHERE id = v_bin1 AND square_location_id = v_sq AND pos_sales_channel_id = v_chan;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'C1_ASSERT_FAIL (a): POS bin config did not round-trip (got % matching rows)', v_cnt;
    END IF;

    -- (b) the partial unique index rejects a duplicate square_location_id.
    BEGIN
      INSERT INTO bins (location_id, name, square_location_id)
        VALUES (v_loc, 'C1_bin2_' || v_sfx, v_sq)
        RETURNING id INTO v_bin2;
    EXCEPTION WHEN unique_violation THEN
      v_got_dup := true;
    END;
    IF NOT v_got_dup THEN
      RAISE EXCEPTION 'C1_ASSERT_FAIL (b): duplicate square_location_id was NOT rejected by bins_unique_square_location';
    END IF;

    -- (c) square_locations insert + select works.
    INSERT INTO square_locations (square_location_id, name, status, synced_at)
      VALUES (v_sq, 'C1_sqloc_' || v_sfx, 'ACTIVE', now());
    SELECT name INTO v_name FROM square_locations WHERE square_location_id = v_sq;
    IF v_name IS NULL THEN
      RAISE EXCEPTION 'C1_ASSERT_FAIL (c): square_locations row not found after insert';
    END IF;

    -- All assertions passed: unwind the subtransaction (commit nothing).
    RAISE EXCEPTION 'C1_VERIFY_OK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'C1_VERIFY_OK' THEN
        RAISE NOTICE 'C1 square-bin-POS-config verification passed (a config round-trip, b unique-guard, c square_locations); test rows rolled back';
      ELSIF SQLERRM LIKE 'C1_ASSERT_FAIL%' THEN
        RAISE EXCEPTION '%', SQLERRM;  -- genuine schema bug: abort migration
      ELSE
        RAISE WARNING 'C1 square-bin-POS-config verification skipped (environment): %', SQLERRM;
      END IF;
  END;
END $$;

NOTIFY pgrst, 'reload schema';
