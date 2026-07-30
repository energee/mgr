-- Retire keg_transactions.keg_type_id (issue #701).
--
-- WHAT BREAKS. On any database built from this migration chain, completing a
-- packaging session whose selling format uses a keg container fails outright:
--
--   ERROR:  null value in column "keg_type_id" of relation "keg_transactions"
--           violates not-null constraint
--   PL/pgSQL function create_finished_goods_from_packaging(uuid) line 130
--   PL/pgSQL function trigger_packaging_session_completion() line 8
--
-- The same NOT NULL blocks every other writer of the table:
-- create_keg_ship_transactions_from_order (00183) on order fulfillment and
-- record_keg_transaction (00190) on any manual keg movement. Only 'package'
-- containers get through, which is why the integration suite has had to route
-- around keg fixtures to test packaging at all.
--
-- WHY. 00032 created keg_type_id NOT NULL REFERENCES keg_types(id). The
-- container/selling-format refactor moved the format key: 00112 restored
-- containers + selling_formats, 00159 added keg_transactions.selling_format_id,
-- and every writer since 00183 supplies selling_format_id and never
-- keg_type_id. Nothing derives it — set_keg_transaction_states is the only
-- BEFORE trigger and it sets from_state/to_state only, and the column has no
-- default. So the value is simply never supplied.
--
-- WHY THIS FIX, and not "supply a keg_type_id". Almost certainly there is
-- nothing to supply. This is an inference from committed artifacts, not a
-- direct read of live -- see STILL UNVERIFIED below, and do not restate it as
-- settled. Live appears to have dropped keg_types out of band, the same class
-- of drift 00254 captured for square_draft_sales.keg_type_id and 00269
-- captured for the 00080 xor constraints. Two live-derived artifacts agree:
-- supabase/live-catalog.snapshot.txt emits one TABLE| line per public base
-- table (scripts/live-catalog.sql, relkind='r') and has none for keg_types,
-- and src/types/supabase.ts — generated from the hosted project — has no
-- keg_type_id on keg_transactions and no keg_types table at all. Naming the
-- column in the function's INSERT would therefore break the very flow this
-- fixes, on production, with `column "keg_type_id" ... does not exist`.
-- Nor is there a sound selling_format -> keg_type lookup to invent: 00112
-- backfilled keg_types into keg containers matched on name, so a keg container
-- created any time after that refactor — i.e. every one created through the
-- UI, including the one in the issue's reproduction — has no keg_types row to
-- find. The keg identity a transaction needs is already recorded, as
-- selling_format_id -> containers.type = 'keg'.
--
-- STILL UNVERIFIED: whether live carries the column at all. The snapshot
-- records tables, functions, triggers and policies but not columns, so only
-- an operator running information_schema.columns against live can settle it.
-- This migration is SAFE either way (see LIVE-SAFETY), so it does not need to
-- be settled before applying. "Safe" is narrower than "universally
-- applicable", and the difference matters: of the three shapes live can be in,
--   (a) column already gone            -> no-op, the expected case;
--   (b) column present, table empty    -> clean drop;
--   (c) column present WITH legacy rows -> the migration ABORTS, by design.
-- Shape (c) is not repaired, it is refused, and on live it is the likely shape
-- if the column survives at all: 00112's UUID-reuse backfill is guarded by
-- `IF to_regclass('public.keg_types') IS NOT NULL`, and 00112's own header
-- says the legacy tables were already gone when it ran against live -- so
-- live's selling_formats ids were never seeded from keg_type ids and no
-- legacy value would map. Do not describe this migration as "the repair" for
-- a live database that still carries the column; it is the detector.
--
-- LIVE-SAFETY. DROP COLUMN IF EXISTS is a no-op where the column is already
-- gone. Where it still exists, the legacy reference is preserved before it is
-- dropped: 00112 deliberately reuses each keg_type UUID as the id of its
-- replacement selling_format, so a non-null keg_type_id backfills
-- selling_format_id losslessly. Any row that would lose information — a
-- keg_type_id disagreeing with an already-set selling_format_id, or one with
-- no matching selling_format — aborts the migration instead. On a fresh
-- replay the table is empty and every guard is a no-op.
--
-- SCOPE. keg_transactions only. The sibling legacy keg_type_id columns on
-- order_items, session_line_items, finished_goods and square_catalog_map are
-- nullable and block nothing. keg_owner_deposits.keg_type_id is also NOT NULL
-- and will block keg-deposit writes on a replayed chain the same way, but no
-- packaging or fulfillment path writes that table; retiring it is separate
-- work with its own reproduction.

DO $$
DECLARE
  v_mismatched BIGINT;
  v_unmapped BIGINT;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'public.keg_transactions'::regclass
      AND attname = 'keg_type_id'
      AND attnum > 0
      AND NOT attisdropped
  ) THEN
    EXECUTE $sql$
      SELECT count(*)
      FROM public.keg_transactions
      WHERE keg_type_id IS NOT NULL
        AND selling_format_id IS NOT NULL
        AND keg_type_id <> selling_format_id
    $sql$
    INTO v_mismatched;

    IF v_mismatched > 0 THEN
      RAISE EXCEPTION
        'Cannot retire keg_transactions.keg_type_id: % row(s) disagree with selling_format_id',
        v_mismatched;
    END IF;

    EXECUTE $sql$
      UPDATE public.keg_transactions AS txn
      SET selling_format_id = txn.keg_type_id
      WHERE txn.selling_format_id IS NULL
        AND txn.keg_type_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.selling_formats AS format
          WHERE format.id = txn.keg_type_id
        )
    $sql$;

    EXECUTE $sql$
      SELECT count(*)
      FROM public.keg_transactions
      WHERE keg_type_id IS NOT NULL
        AND selling_format_id IS NULL
    $sql$
    INTO v_unmapped;

    IF v_unmapped > 0 THEN
      RAISE EXCEPTION
        'Cannot retire keg_transactions.keg_type_id: % row(s) have no matching selling_format',
        v_unmapped;
    END IF;
  END IF;
END
$$;

-- 00032 created idx_keg_transactions_keg_type; 00129/00136 created
-- idx_keg_transactions_keg_type_id. Both would be dropped with the column, but
-- naming them keeps the intent visible.
DROP INDEX IF EXISTS public.idx_keg_transactions_keg_type;
DROP INDEX IF EXISTS public.idx_keg_transactions_keg_type_id;

ALTER TABLE public.keg_transactions
  DROP COLUMN IF EXISTS keg_type_id;

COMMENT ON COLUMN public.keg_transactions.selling_format_id IS
  'Selling format the kegs move as; its container (containers.type = ''keg'') is the keg identity. Replaces the retired keg_type_id contract.';

UPDATE public._schema_registry
SET key_fields = '["id", "transaction_type", "selling_format_id", "quantity", "from_state", "to_state", "created_at"]'::jsonb,
    relationships = '{"orders": "order_id", "batches": "batch_id", "customers": "customer_id", "selling_formats": "selling_format_id", "keg_owners": "keg_owner_id", "locations": "from_location_id/to_location_id", "finished_goods": "finished_good_id"}'::jsonb
WHERE table_name = 'keg_transactions';

-- Self-rolling-back proof that the write shape every keg writer uses now
-- works, and that no physical keg_type_id column remains after a fresh or a
-- live upgrade. Mirrors the verification block in 00254.
DO $$
DECLARE
  v_suffix TEXT := replace(gen_random_uuid()::text, '-', '');
  v_container UUID;
  v_format UUID;
  v_batch UUID;
  v_txn UUID;
BEGIN
  BEGIN
    INSERT INTO public.containers (name, type, volume_bbl)
    VALUES ('KT_container_' || v_suffix, 'keg', 0.5)
    RETURNING id INTO v_container;

    INSERT INTO public.selling_formats (container_id, name, unit_count)
    VALUES (v_container, 'Per Keg', 1)
    RETURNING id INTO v_format;

    INSERT INTO public.batches (batch_code, name, status, volume_bbl)
    VALUES ('KT_batch_' || left(v_suffix, 12), 'KT batch ' || v_suffix, 'packaging', 10)
    RETURNING id INTO v_batch;

    INSERT INTO public.keg_transactions (
      transaction_type,
      selling_format_id,
      quantity,
      from_state,
      to_state,
      batch_id
    )
    VALUES ('fill', v_format, 1, 'empty', 'filled', v_batch)
    RETURNING id INTO v_txn;

    IF v_txn IS NULL THEN
      RAISE EXCEPTION 'KT_ASSERT_FAIL: keg fill insert returned no id';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_attribute
      WHERE attrelid = 'public.keg_transactions'::regclass
        AND attname = 'keg_type_id'
        AND attnum > 0
        AND NOT attisdropped
    ) THEN
      RAISE EXCEPTION 'KT_ASSERT_FAIL: keg_type_id still exists';
    END IF;

    RAISE EXCEPTION 'KT_VERIFY_OK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'KT_VERIFY_OK' THEN
        RAISE NOTICE 'KT keg_transactions verification passed (selling_format-only fill; legacy keg_type_id absent); test rows rolled back';
      ELSE
        RAISE EXCEPTION '%', SQLERRM;
      END IF;
  END;
END
$$;

NOTIFY pgrst, 'reload schema';
