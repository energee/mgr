-- Retire keg_owner_deposits.keg_type_id (issue #711).
--
-- WHAT THIS CHANGES ON THE CHAIN. 00079 created keg_owner_deposits with
-- keg_type_id NOT NULL REFERENCES keg_types(id) and
-- UNIQUE (keg_owner_id, keg_type_id). The container/selling-format refactor
-- moved the format key: 00159 added the nullable selling_format_id column, and
-- every current reader — keg_aging_report (00191), keg_fleet_summary (00236),
-- the deposit COALESCE against containers.deposit_amount — joins on
-- selling_format_id and never keg_type_id. Nothing derives keg_type_id and the
-- column has no default, so on a database built from this chain any write to
-- keg_owner_deposits fails with
--
--   ERROR:  null value in column "keg_type_id" of relation "keg_owner_deposits"
--           violates not-null constraint
--
-- the same failure shape 00283 retired for keg_transactions (#701). Unlike
-- #701 no packaging or fulfillment path writes this table, so the break is
-- latent — it blocks the per-owner deposit override path, not a shipped flow.
--
-- This migration mirrors 00283's pattern exactly:
--   1. Where the column exists, backfill selling_format_id from keg_type_id
--      (00112 deliberately reuses each keg_type UUID as the id of its
--      replacement selling_format, so a non-null keg_type_id maps losslessly).
--   2. Abort instead of dropping information: a keg_type_id disagreeing with
--      an already-set selling_format_id, or one with no matching
--      selling_format, raises rather than drops.
--   3. Drop the legacy index and the column (the FK and the
--      UNIQUE (keg_owner_id, keg_type_id) constraint go with it).
--   4. Recreate the uniqueness contract on (keg_owner_id, selling_format_id).
--
-- Every step is conditional/IF EXISTS, so on a database where the column is
-- already absent the guards are no-ops and only the unique index and metadata
-- updates apply. Whether any given deployed database still carries the column
-- is not asserted here — the DO-block guards make the migration correct in
-- either shape, and a legacy row that cannot be mapped aborts by design.
--
-- SCOPE. keg_owner_deposits only. This is the last NOT NULL keg_type_id in the
-- chain; the remaining siblings (order_items, session_line_items,
-- finished_goods, square_catalog_map) are nullable and block nothing. Whether
-- keg_types itself should leave the chain is separate work (#711 discussion).

DO $$
DECLARE
  v_mismatched BIGINT;
  v_unmapped BIGINT;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'public.keg_owner_deposits'::regclass
      AND attname = 'keg_type_id'
      AND attnum > 0
      AND NOT attisdropped
  ) THEN
    EXECUTE $sql$
      SELECT count(*)
      FROM public.keg_owner_deposits
      WHERE keg_type_id IS NOT NULL
        AND selling_format_id IS NOT NULL
        AND keg_type_id <> selling_format_id
    $sql$
    INTO v_mismatched;

    IF v_mismatched > 0 THEN
      RAISE EXCEPTION
        'Cannot retire keg_owner_deposits.keg_type_id: % row(s) disagree with selling_format_id',
        v_mismatched;
    END IF;

    EXECUTE $sql$
      UPDATE public.keg_owner_deposits AS dep
      SET selling_format_id = dep.keg_type_id
      WHERE dep.selling_format_id IS NULL
        AND dep.keg_type_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.selling_formats AS format
          WHERE format.id = dep.keg_type_id
        )
    $sql$;

    EXECUTE $sql$
      SELECT count(*)
      FROM public.keg_owner_deposits
      WHERE keg_type_id IS NOT NULL
        AND selling_format_id IS NULL
    $sql$
    INTO v_unmapped;

    IF v_unmapped > 0 THEN
      RAISE EXCEPTION
        'Cannot retire keg_owner_deposits.keg_type_id: % row(s) have no matching selling_format',
        v_unmapped;
    END IF;
  END IF;
END
$$;

-- 00129/00136 created idx_keg_owner_deposits_keg_type_id. It would be dropped
-- with the column, but naming it keeps the intent visible (00283 pattern).
DROP INDEX IF EXISTS public.idx_keg_owner_deposits_keg_type_id;

-- Dropping the column also drops the keg_types FK and the
-- UNIQUE (keg_owner_id, keg_type_id) constraint 00079 declared inline.
ALTER TABLE public.keg_owner_deposits
  DROP COLUMN IF EXISTS keg_type_id;

-- Recreate the per-owner-per-format uniqueness contract on the modern key.
-- If duplicate (keg_owner_id, selling_format_id) rows exist this CREATE aborts
-- the migration — deliberate: a silent dedup would drop a deposit override.
-- NULL selling_format_id rows are not constrained (NULLs compare distinct).
CREATE UNIQUE INDEX IF NOT EXISTS uq_keg_owner_deposits_owner_format
  ON public.keg_owner_deposits (keg_owner_id, selling_format_id);

COMMENT ON COLUMN public.keg_owner_deposits.selling_format_id IS
  'Selling format the deposit override applies to; its container (containers.type = ''keg'') is the keg identity. Replaces the retired keg_type_id contract.';

UPDATE public._schema_registry
SET description = 'Per-owner per-selling-format deposit overrides (COALESCEd over containers.deposit_amount)',
    relationships = '{"belongs_to": ["keg_owners", "selling_formats"]}'::jsonb
WHERE table_name = 'keg_owner_deposits';

-- Self-rolling-back proof that the per-owner deposit override write shape now
-- works, and that no physical keg_type_id column remains. Mirrors the
-- verification blocks in 00254/00283.
DO $$
DECLARE
  v_suffix TEXT := replace(gen_random_uuid()::text, '-', '');
  v_container UUID;
  v_format UUID;
  v_owner UUID;
  v_deposit UUID;
BEGIN
  BEGIN
    INSERT INTO public.containers (name, type, volume_bbl)
    VALUES ('KOD_container_' || v_suffix, 'keg', 0.5)
    RETURNING id INTO v_container;

    INSERT INTO public.selling_formats (container_id, name, unit_count)
    VALUES (v_container, 'Per Keg', 1)
    RETURNING id INTO v_format;

    INSERT INTO public.keg_owners (name, code)
    VALUES ('KOD_owner_' || v_suffix, 'kod_' || left(v_suffix, 12))
    RETURNING id INTO v_owner;

    INSERT INTO public.keg_owner_deposits (keg_owner_id, selling_format_id, deposit_amount)
    VALUES (v_owner, v_format, 42.00)
    RETURNING id INTO v_deposit;

    IF v_deposit IS NULL THEN
      RAISE EXCEPTION 'KOD_ASSERT_FAIL: deposit override insert returned no id';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_attribute
      WHERE attrelid = 'public.keg_owner_deposits'::regclass
        AND attname = 'keg_type_id'
        AND attnum > 0
        AND NOT attisdropped
    ) THEN
      RAISE EXCEPTION 'KOD_ASSERT_FAIL: keg_type_id still exists';
    END IF;

    RAISE EXCEPTION 'KOD_VERIFY_OK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'KOD_VERIFY_OK' THEN
        RAISE NOTICE 'KOD keg_owner_deposits verification passed (selling_format-only override; legacy keg_type_id absent); test rows rolled back';
      ELSE
        RAISE EXCEPTION '%', SQLERRM;
      END IF;
  END;
END
$$;

NOTIFY pgrst, 'reload schema';
