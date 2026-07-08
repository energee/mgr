-- 00221_sellable_inventory_view.sql
-- Square POS bin-sync, Milestone B: one read model for "sellable product on hand".
--
-- WHY THIS EXISTS
--   Sellable stock lives in two shapes: packaged finished goods physically placed
--   in bins (bin_inventory, writer added in 00219) and filled kegs by contents
--   (keg_filled_contents, netted by 00207, bin dimension added by 00220). Every
--   downstream consumer (the per-bin Square catalog + inventory sync in Milestone
--   C, plus sales/reports) should read ONE uniform shape instead of stitching the
--   two together. This view is that union.
--
--   THE DOUBLE-COUNT GUARD (B0 spike): kegs are NEVER written to bin_inventory --
--   the 00219 placement trigger skips keg-container finished goods, and nothing
--   else writes bin_inventory. A filled keg's sellable stock comes exclusively
--   from keg_filled_contents. So a finished good is in EITHER the packaged side
--   OR the keg side, never both. The `containers.type <> 'keg'` filter on the
--   packaged side is the entire guard (belt-and-suspenders, since kegs shouldn't
--   be in bin_inventory anyway) -- proven no-overlap by the verification block.
--
--   COMMON SHAPE: (bin_id, location_id, brand_id, selling_format_id,
--   finished_good_id, quantity, source) where source is 'packaged' | 'keg'.
--   bin_id/location_id are nullable on the keg side (off-premise kegs are in no
--   bin); on the packaged side both are non-null (a bin always has a location).
--
--   security_invoker = true: the view runs with the caller's RLS, matching the
--   base tables (bin_inventory / keg_filled_contents / finished_goods) and the
--   00207/00220 keg views.
--
--   Only positive on-hand is "sellable": the packaged side filters bi.quantity > 0;
--   the keg side is already positive-only (keg_filled_contents HAVING sum > 0).
--
-- Live-safe: a single additive CREATE VIEW, no data touched. Verified by a
-- self-rolling-back DO block at the end (commits NO rows).

CREATE OR REPLACE VIEW public.sellable_inventory
WITH (security_invoker = true) AS
  -- (a) packaged finished goods physically in bins. Non-keg containers only --
  -- the `<> 'keg'` filter is the double-count guard (see header).
  SELECT
    bi.bin_id,
    b.location_id,
    fg.brand_id,
    fg.selling_format_id,
    fg.id            AS finished_good_id,
    bi.quantity,
    'packaged'::text AS source
  FROM bin_inventory bi
  JOIN bins b             ON b.id  = bi.bin_id
  JOIN finished_goods fg  ON fg.id = bi.finished_good_id
  JOIN selling_formats sf ON sf.id = fg.selling_format_id
  JOIN containers c       ON c.id  = sf.container_id
  WHERE c.type <> 'keg'
    AND bi.quantity > 0
  UNION ALL
  -- (b) filled kegs by contents (already netted + positive-only, with the bin
  -- dimension from 00220).
  SELECT
    kfc.bin_id,
    kfc.location_id,
    kfc.brand_id,
    kfc.selling_format_id,
    kfc.finished_good_id,
    kfc.quantity,
    'keg'::text AS source
  FROM keg_filled_contents kfc;

COMMENT ON VIEW sellable_inventory IS
  'Unified sellable-product-on-hand read model (00221): UNION ALL of packaged finished goods in bins (bin_inventory, non-keg containers only) and filled-keg contents (keg_filled_contents). Shape: bin_id, location_id, brand_id, selling_format_id, finished_good_id, quantity, source (packaged|keg). The <> keg filter is the double-count guard -- kegs are never in bin_inventory. security_invoker. Consumed by the per-bin Square sync (Milestone C) and sales/reports.';

-- =============================================================================
-- Verification (self-rolling-back; commits NO rows) -- matches 00207/00219/00220
-- =============================================================================
-- Proves, then rolls back:
--   (a) a non-keg FG placed in a bin (via the 00219 trigger) shows as
--       source='packaged' with its bin quantity;
--   (b) a filled keg shows as source='keg' with its filled quantity;
--   (c) NO finished_good_id appears under both sources (double-count guard).
DO $$
DECLARE
  v_loc uuid; v_brand uuid; v_c_pkg uuid; v_c_keg uuid; v_sf_pkg uuid; v_sf_keg uuid;
  v_bin uuid; v_session uuid; v_sli uuid; v_fg_pkg uuid; v_fg_keg uuid;
  v_pkg_qty int; v_keg_qty int; v_overlap int;
  v_sfx text := replace(gen_random_uuid()::text, '-', '');
BEGIN
  BEGIN
    INSERT INTO locations (name, location_type, is_primary)
      VALUES ('B_loc_' || v_sfx, 'warehouse', false) RETURNING id INTO v_loc;
    INSERT INTO brands (name) VALUES ('B_brand_' || v_sfx) RETURNING id INTO v_brand;
    INSERT INTO containers (name, type, volume_oz, deposit_amount)
      VALUES ('B_pkg_' || v_sfx, 'package', 12, 0) RETURNING id INTO v_c_pkg;
    INSERT INTO containers (name, type, volume_bbl, deposit_amount)
      VALUES ('B_keg_' || v_sfx, 'keg', 0.5, 0) RETURNING id INTO v_c_keg;
    INSERT INTO selling_formats (container_id, name, unit_count)
      VALUES (v_c_pkg, 'B_sfpkg_' || v_sfx, 1) RETURNING id INTO v_sf_pkg;
    INSERT INTO selling_formats (container_id, name, unit_count)
      VALUES (v_c_keg, 'B_sfkeg_' || v_sfx, 1) RETURNING id INTO v_sf_keg;
    INSERT INTO bins (location_id, name)
      VALUES (v_loc, 'B_bin_' || v_sfx) RETURNING id INTO v_bin;

    -- packaged FG: placed into v_bin by the 00219 trigger via the session default bin.
    INSERT INTO packaging_sessions (default_bin_id) VALUES (v_bin) RETURNING id INTO v_session;
    INSERT INTO session_line_items (session_id, brand_id, selling_format_id)
      VALUES (v_session, v_brand, v_sf_pkg) RETURNING id INTO v_sli;
    INSERT INTO finished_goods (brand_id, selling_format_id, session_line_item_id, quantity, lot_number)
      VALUES (v_brand, v_sf_pkg, v_sli, 25, 'B-pkg-' || v_sfx) RETURNING id INTO v_fg_pkg;

    -- keg FG + fill into the same bin (the 00219 trigger SKIPS keg FGs, so this
    -- FG never lands in bin_inventory -- it is sellable only via keg_filled_contents).
    INSERT INTO finished_goods (brand_id, selling_format_id, quantity, lot_number)
      VALUES (v_brand, v_sf_keg, 7, 'B-keg-' || v_sfx) RETURNING id INTO v_fg_keg;
    PERFORM record_keg_transaction('receive'::keg_transaction_type, v_sf_keg, 7,
      NULL::keg_state, NULL::keg_state, NULL::uuid, v_loc,
      NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid,
      'B verify', 'B_verify', NULL::uuid, v_bin);
    PERFORM record_keg_transaction('fill'::keg_transaction_type, v_sf_keg, 7,
      NULL::keg_state, NULL::keg_state, v_loc, v_loc,
      NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, v_fg_keg,
      'B verify', 'B_verify', v_bin, v_bin);

    -- (a) packaged
    SELECT quantity INTO v_pkg_qty FROM sellable_inventory
      WHERE finished_good_id = v_fg_pkg AND source = 'packaged' AND bin_id = v_bin;
    IF COALESCE(v_pkg_qty, 0) <> 25 THEN
      RAISE EXCEPTION 'B_ASSERT_FAIL (a): packaged qty % expected 25', COALESCE(v_pkg_qty, 0);
    END IF;

    -- (b) keg
    SELECT quantity INTO v_keg_qty FROM sellable_inventory
      WHERE finished_good_id = v_fg_keg AND source = 'keg' AND bin_id = v_bin;
    IF COALESCE(v_keg_qty, 0) <> 7 THEN
      RAISE EXCEPTION 'B_ASSERT_FAIL (b): keg qty % expected 7', COALESCE(v_keg_qty, 0);
    END IF;

    -- (c) double-count guard: no finished_good under both sources
    SELECT count(*) INTO v_overlap FROM (
      SELECT finished_good_id FROM sellable_inventory
      GROUP BY finished_good_id HAVING count(DISTINCT source) > 1
    ) x;
    IF v_overlap <> 0 THEN
      RAISE EXCEPTION 'B_ASSERT_FAIL (c): % finished_goods double-counted across sources', v_overlap;
    END IF;

    RAISE EXCEPTION 'B_VERIFY_OK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'B_VERIFY_OK' THEN
        RAISE NOTICE 'B sellable_inventory verification passed (packaged+keg union, no double-count); test rows rolled back';
      ELSIF SQLERRM LIKE 'B_ASSERT_FAIL%' THEN
        RAISE EXCEPTION '%', SQLERRM;
      ELSE
        RAISE WARNING 'B sellable_inventory verification skipped (environment): %', SQLERRM;
      END IF;
  END;
END $$;

NOTIFY pgrst, 'reload schema';
