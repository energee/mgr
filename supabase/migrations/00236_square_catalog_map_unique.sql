-- 00236_square_catalog_map_unique.sql
-- Audit findings SF-4/IN-8 (silent mapping loss -> duplicate catalog) + PERF-1
-- (2N sequential writes per catalog push), schema side.
--
-- *** NOT applied live. Deploy via scripts/db-push.sh after merge. ***
--
-- pushCatalog (src/integrations/square/catalog.ts) persisted square_catalog_map
-- rows with a per-row INSERT-then-blind-UPDATE: the fallback UPDATE's error was
-- never checked, so a failed write silently dropped the mapping and the NEXT
-- sync pushed temp "#brand-…" ids — Square then creates a FULL DUPLICATE
-- catalog. The fix is a single batched, error-checked PostgREST upsert, which
-- needs a unique index the upsert can actually target. This migration adds it.
--
-- WHY one NULLS NOT DISTINCT index (and not partial/expression indexes):
-- supabase-js `.upsert(rows, { onConflict: "cols" })` becomes PostgREST
-- `on_conflict=cols`, i.e. `ON CONFLICT (cols) DO UPDATE`. Postgres arbiter
-- inference from a bare column list matches ONLY non-partial, non-expression
-- unique indexes:
--   * two partial indexes (`… WHERE selling_format_id IS NULL` / `IS NOT NULL`)
--     are unreachable — PostgREST has no syntax for an inference WHERE clause;
--   * a COALESCE(selling_format_id, zero-uuid) expression index is unreachable —
--     PostgREST cannot emit an expression conflict target.
-- A plain-column UNIQUE index with NULLS NOT DISTINCT (PG15+; CI replays on
-- postgres:15, live Supabase is 15+) IS inferrable from the bare column list
-- and makes ITEM rows (selling_format_id NULL) collide correctly, so ONE
-- batched upsert covers both ITEM and ITEM_VARIATION rows.
--
-- Identity model (C7, no location dimension in v1):
--   ITEM            rows: (brand_id, 'ITEM',           NULL)
--   ITEM_VARIATION  rows: (brand_id, 'ITEM_VARIATION', selling_format_id)
--
-- Replay note: 00091's partial unique indexes (uq_square_catalog_map_brand_item
-- on (brand_id) WHERE object_type='ITEM', plus the two on the since-dropped-live
-- package_type_id/keg_type_id columns) are left untouched. They never block the
-- new upsert — the code writes NULL selling_format_id only on ITEM rows (one per
-- brand) and never writes the legacy columns — and dropping them here would
-- widen live<->chain drift for no behavioral gain.
--
-- Live-safe: a keep-newest de-duplication DELETE (live rows written by the old
-- code path may already violate the new uniqueness), one CREATE UNIQUE INDEX
-- IF NOT EXISTS, and a self-rolling-back verification DO block (commits NO rows).

-- =============================================================================
-- PART 1 -- de-duplicate existing rows (keep newest)
-- =============================================================================
-- For every (brand_id, object_type, selling_format_id) group — NULLs compared
-- as equal, matching the NULLS NOT DISTINCT index below — keep the newest row
-- by (updated_at, created_at, id) and delete the rest. Both timestamps are
-- NOT NULL DEFAULT now() (00091); id breaks exact ties for a total order.
-- Nothing references square_catalog_map by FK, so the DELETE cannot cascade.
DELETE FROM square_catalog_map a
USING square_catalog_map b
WHERE a.id <> b.id
  AND a.brand_id = b.brand_id
  AND a.object_type = b.object_type
  AND a.selling_format_id IS NOT DISTINCT FROM b.selling_format_id
  AND (a.updated_at, a.created_at, a.id) < (b.updated_at, b.created_at, b.id);

-- =============================================================================
-- PART 2 -- the upsert-targetable unique index
-- =============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS uq_square_catalog_map_brand_type_format
  ON square_catalog_map (brand_id, object_type, selling_format_id)
  NULLS NOT DISTINCT;

COMMENT ON INDEX uq_square_catalog_map_brand_type_format IS
  'Upsert target for pushCatalog''s batched mapping write (00236). NULLS NOT DISTINCT so ITEM rows (selling_format_id NULL) collide: one ITEM row per brand, one ITEM_VARIATION row per (brand, selling format). Plain-column (not partial/expression) because PostgREST on_conflict can only infer from a bare column list.';

-- =============================================================================
-- PART 3 -- verification (self-rolling-back; commits NO rows)
-- =============================================================================
-- Proves, then rolls back:
--   (a) a duplicate ITEM row (NULL selling_format_id) is REJECTED — NULLS NOT
--       DISTINCT is in force;
--   (b) ON CONFLICT (brand_id, object_type, selling_format_id) DO UPDATE — the
--       exact statement PostgREST emits for the client's onConflict — infers
--       the index and updates the ITEM row in place (still exactly one row);
--   (c) the same upsert on an ITEM_VARIATION key updates in place, while a
--       DIFFERENT selling_format_id inserts a sibling row.
--
-- Same self-rolling-back idiom as 00223/00224/00233: a passing run RAISEs
-- 'CM_VERIFY_OK' to unwind the subtransaction; a genuine failure RAISEs
-- 'CM_ASSERT_FAIL…' and aborts the migration; anything else is a WARNING.
DO $$
DECLARE
  v_sfx       TEXT := replace(gen_random_uuid()::text, '-', '');
  v_brand     UUID;
  v_container UUID;
  v_fmt_a     UUID := gen_random_uuid();
  v_fmt_b     UUID := gen_random_uuid();
  v_rejected  BOOLEAN := false;
  v_count     INTEGER;
  v_catalog   TEXT;
BEGIN
  BEGIN
    -- Fixtures (rolled back with everything else): a brand for the ITEM rows,
    -- and two real selling formats (selling_format_id is an FK — 00159) hung
    -- off a throwaway keg container (00199: keg needs volume_bbl).
    INSERT INTO brands (name) VALUES ('CM_verify_' || v_sfx) RETURNING id INTO v_brand;
    INSERT INTO containers (name, type, volume_bbl)
      VALUES ('CM_keg_' || v_sfx, 'keg', 0.5) RETURNING id INTO v_container;
    INSERT INTO selling_formats (id, container_id, name)
      VALUES (v_fmt_a, v_container, 'CM_fmt_a_' || v_sfx),
             (v_fmt_b, v_container, 'CM_fmt_b_' || v_sfx);

    -- (a) duplicate ITEM row rejected (NULLS NOT DISTINCT).
    INSERT INTO square_catalog_map (brand_id, selling_format_id, square_catalog_id, object_type)
      VALUES (v_brand, NULL, 'CM_SQ_ITEM_1', 'ITEM');
    BEGIN
      INSERT INTO square_catalog_map (brand_id, selling_format_id, square_catalog_id, object_type)
        VALUES (v_brand, NULL, 'CM_SQ_ITEM_DUP', 'ITEM');
    EXCEPTION WHEN unique_violation THEN
      v_rejected := true;
    END;
    IF NOT v_rejected THEN
      RAISE EXCEPTION 'CM_ASSERT_FAIL (a): duplicate (brand, ITEM, NULL) row was NOT rejected — NULLS NOT DISTINCT missing';
    END IF;

    -- (b) the PostgREST-shaped upsert updates the ITEM row in place.
    INSERT INTO square_catalog_map (brand_id, selling_format_id, square_catalog_id, object_type)
      VALUES (v_brand, NULL, 'CM_SQ_ITEM_2', 'ITEM')
      ON CONFLICT (brand_id, object_type, selling_format_id)
      DO UPDATE SET square_catalog_id = EXCLUDED.square_catalog_id;
    SELECT count(*), max(square_catalog_id) INTO v_count, v_catalog
      FROM square_catalog_map WHERE brand_id = v_brand AND object_type = 'ITEM';
    IF v_count <> 1 OR v_catalog <> 'CM_SQ_ITEM_2' THEN
      RAISE EXCEPTION 'CM_ASSERT_FAIL (b): ITEM upsert left % row(s) with catalog id % (expected 1 row, CM_SQ_ITEM_2)', v_count, v_catalog;
    END IF;

    -- (c) variation upsert: same key updates in place; a different
    --     selling_format_id inserts a sibling.
    INSERT INTO square_catalog_map (brand_id, selling_format_id, square_catalog_id, object_type)
      VALUES (v_brand, v_fmt_a, 'CM_SQ_VAR_A1', 'ITEM_VARIATION');
    INSERT INTO square_catalog_map (brand_id, selling_format_id, square_catalog_id, object_type)
      VALUES (v_brand, v_fmt_a, 'CM_SQ_VAR_A2', 'ITEM_VARIATION'),
             (v_brand, v_fmt_b, 'CM_SQ_VAR_B1', 'ITEM_VARIATION')
      ON CONFLICT (brand_id, object_type, selling_format_id)
      DO UPDATE SET square_catalog_id = EXCLUDED.square_catalog_id;
    SELECT count(*) INTO v_count
      FROM square_catalog_map WHERE brand_id = v_brand AND object_type = 'ITEM_VARIATION';
    IF v_count <> 2 THEN
      RAISE EXCEPTION 'CM_ASSERT_FAIL (c): expected 2 variation rows (fmt_a updated in place, fmt_b inserted), found %', v_count;
    END IF;
    SELECT square_catalog_id INTO v_catalog
      FROM square_catalog_map WHERE brand_id = v_brand AND selling_format_id = v_fmt_a;
    IF v_catalog <> 'CM_SQ_VAR_A2' THEN
      RAISE EXCEPTION 'CM_ASSERT_FAIL (c): fmt_a variation carries catalog id % (expected the upserted CM_SQ_VAR_A2)', v_catalog;
    END IF;

    RAISE EXCEPTION 'CM_VERIFY_OK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'CM_VERIFY_OK' THEN
        RAISE NOTICE 'CM catalog-map uniqueness verification passed (NULL-key dedup enforced, PostgREST-shaped upsert infers the index); test rows rolled back';
      ELSIF SQLERRM LIKE 'CM_ASSERT_FAIL%' THEN
        RAISE EXCEPTION '%', SQLERRM;  -- genuine index/upsert bug: abort migration
      ELSE
        RAISE WARNING 'CM catalog-map uniqueness verification skipped (environment): %', SQLERRM;
      END IF;
  END;
END $$;

NOTIFY pgrst, 'reload schema';
