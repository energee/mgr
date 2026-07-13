-- 00244_brands_is_active.sql
-- Catalog keep-set safety (audit IN-9, backlog P2 #16): brands.is_active.
--
-- *** NOT applied live. Deploy via scripts/db-push.sh after merge. ***
--
-- NUMBERING: 00237-00243 and 00245-00248 are claimed/reserved by other
-- in-flight branches; 00244 is the number reserved for this branch.
--
-- The Square catalog stale-cleanup KEEP set was DERIVED from POS-bin config
-- state (in-stock brands at POS bins UNION bin_inventory rows at POS bins
-- UNION any keg-format finished-good brand -- sync/catalog/route.ts).
-- Re-pointing a bin's POS target before physically moving stock shrank that
-- read, dropped packaged brands from the keep set, and deleteStaleItems
-- bulk-deleted their live Square items/variations (destroying images and
-- Item-Sales reporting continuity). The recorded upgrade path (the route's
-- ponytail comment + audit followups) was: add brands.is_active and key the
-- WHOLE keep set off it, dropping stock inference entirely -- an inactive
-- brand is an INTENTIONAL removal; a shrunken or failed read is not.
--
-- Live-safe: one additive column with a constant default (PG11+ fast path,
-- no table rewrite). All existing brands backfill to active -- matching
-- today's behavior, where nothing is ever auto-discontinued.

ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN brands.is_active IS
  'Whether this brand is a live product (00244, audit IN-9). The Square catalog sync keeps every ACTIVE brand''s mapped objects (even sold out); false = discontinued -- the brand drops out of the stale-cleanup keep set, so its Square items/variations are deleted on the next catalog push. An INTENTIONAL removal path, unlike stock/bin-config state, which merely reflects what happens to be on hand. Edited via the brand entity form (Active switch).';

-- =============================================================================
-- Verification (self-rolling-back; commits NO rows)
-- =============================================================================
-- Proves, then rolls back:
--   (a) a new brand defaults is_active = true (every pre-00244 brand stays in
--       the Square keep set -- behavior-preserving backfill);
--   (b) is_active flips to false and reads back (the discontinue path the
--       catalog keep set keys off).
-- Same self-rolling-back idiom as 00223/00224/00233/00240: a passing run
-- RAISEs 'BIA_VERIFY_OK' to unwind the subtransaction (commits nothing); a
-- genuine schema bug RAISEs 'BIA_ASSERT_FAIL...' and re-raises to ABORT the
-- migration; any other error (missing prerequisites on an exotic replay) is
-- downgraded to a WARNING so the DDL above still applies.
DO $$
DECLARE
  v_sfx    TEXT := replace(gen_random_uuid()::text, '-', '');
  v_brand  UUID;
  v_active BOOLEAN;
BEGIN
  BEGIN
    -- (a) default
    INSERT INTO brands (name) VALUES ('BIA_brand_' || v_sfx) RETURNING id INTO v_brand;
    SELECT is_active INTO v_active FROM brands WHERE id = v_brand;
    IF v_active IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'BIA_ASSERT_FAIL (a): new brand is_active defaulted to % (expected true)', v_active;
    END IF;

    -- (b) flip
    UPDATE brands SET is_active = false WHERE id = v_brand;
    SELECT is_active INTO v_active FROM brands WHERE id = v_brand;
    IF v_active IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'BIA_ASSERT_FAIL (b): is_active did not persist false (read %)', v_active;
    END IF;

    RAISE EXCEPTION 'BIA_VERIFY_OK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'BIA_VERIFY_OK' THEN
        RAISE NOTICE 'BIA brands.is_active verification passed (a defaults true, b flips false); test rows rolled back';
      ELSIF SQLERRM LIKE 'BIA_ASSERT_FAIL%' THEN
        RAISE EXCEPTION '%', SQLERRM;  -- genuine schema bug: abort migration
      ELSE
        RAISE WARNING 'BIA brands.is_active verification skipped (environment): %', SQLERRM;
      END IF;
  END;
END $$;

NOTIFY pgrst, 'reload schema';
