-- Canonicalize square_draft_sales on selling_formats.
--
-- The fresh migration chain still retained 00091's required keg_type_id even
-- though the Square webhook has written only selling_format_id since the
-- container/selling-format refactor. The hosted schema already dropped the
-- legacy column. This migration converges both histories without discarding a
-- legacy reference: 00112 deliberately reuses each keg_type UUID for its
-- replacement selling_format, so replayed rows can be backfilled losslessly.

ALTER TABLE public.square_draft_sales
  ADD COLUMN IF NOT EXISTS selling_format_id UUID;

DO $$
DECLARE
  v_mismatched BIGINT;
  v_unmapped BIGINT;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'public.square_draft_sales'::regclass
      AND attname = 'keg_type_id'
      AND attnum > 0
      AND NOT attisdropped
  ) THEN
    EXECUTE $sql$
      SELECT count(*)
      FROM public.square_draft_sales
      WHERE keg_type_id IS NOT NULL
        AND selling_format_id IS NOT NULL
        AND keg_type_id <> selling_format_id
    $sql$
    INTO v_mismatched;

    IF v_mismatched > 0 THEN
      RAISE EXCEPTION
        'Cannot retire square_draft_sales.keg_type_id: % row(s) disagree with selling_format_id',
        v_mismatched;
    END IF;

    EXECUTE $sql$
      UPDATE public.square_draft_sales AS draft
      SET selling_format_id = draft.keg_type_id
      WHERE draft.selling_format_id IS NULL
        AND EXISTS (
          SELECT 1
          FROM public.selling_formats AS format
          WHERE format.id = draft.keg_type_id
        )
    $sql$;

    EXECUTE $sql$
      SELECT count(*)
      FROM public.square_draft_sales
      WHERE keg_type_id IS NOT NULL
        AND selling_format_id IS NULL
    $sql$
    INTO v_unmapped;

    IF v_unmapped > 0 THEN
      RAISE EXCEPTION
        'Cannot retire square_draft_sales.keg_type_id: % row(s) have no matching selling_format',
        v_unmapped;
    END IF;
  END IF;
END
$$;

DROP INDEX IF EXISTS public.uq_square_draft_sales_dedup;
DROP INDEX IF EXISTS public.idx_square_draft_sales_keg_type_id;

ALTER TABLE public.square_draft_sales
  DROP COLUMN IF EXISTS keg_type_id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.square_draft_sales'::regclass
      AND conname = 'square_draft_sales_selling_format_id_fkey'
  ) THEN
    ALTER TABLE public.square_draft_sales
      ADD CONSTRAINT square_draft_sales_selling_format_id_fkey
      FOREIGN KEY (selling_format_id)
      REFERENCES public.selling_formats(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE UNIQUE INDEX uq_square_draft_sales_dedup
  ON public.square_draft_sales (square_order_id, brand_id, selling_format_id);

COMMENT ON COLUMN public.square_draft_sales.selling_format_id IS
  'Selling format sold by the Square draft variation. Replaces the retired keg_type_id contract; nullable only for historical rows that predate format mapping.';

UPDATE public._schema_registry
SET description = 'Draft beer sales ingested from Square POS for inventory deduction and TTB reconciliation',
    key_fields = '["square_order_id", "brand_id", "selling_format_id", "quantity", "sold_at"]'::jsonb,
    relationships = '{"belongs_to": ["brands", "selling_formats", "locations"]}'::jsonb
WHERE table_name = 'square_draft_sales';

-- Self-rolling-back proof that the webhook's canonical insert shape works and
-- that no physical keg_type_id column remains after a fresh or live upgrade.
DO $$
DECLARE
  v_suffix TEXT := replace(gen_random_uuid()::text, '-', '');
  v_container UUID;
  v_format UUID;
  v_brand UUID;
  v_location UUID;
  v_draft UUID;
BEGIN
  BEGIN
    INSERT INTO public.containers (name, type, volume_bbl)
    VALUES ('SD_container_' || v_suffix, 'keg', 0.5)
    RETURNING id INTO v_container;

    INSERT INTO public.selling_formats (container_id, name, unit_count)
    VALUES (v_container, 'Per Keg', 1)
    RETURNING id INTO v_format;

    INSERT INTO public.brands (name)
    VALUES ('SD_brand_' || v_suffix)
    RETURNING id INTO v_brand;

    INSERT INTO public.locations (name)
    VALUES ('SD_location_' || v_suffix)
    RETURNING id INTO v_location;

    INSERT INTO public.square_draft_sales (
      square_order_id,
      brand_id,
      selling_format_id,
      quantity,
      volume_oz,
      location_id,
      sold_at
    )
    VALUES (
      'SD_order_' || v_suffix,
      v_brand,
      v_format,
      1,
      16,
      v_location,
      now()
    )
    RETURNING id INTO v_draft;

    IF v_draft IS NULL THEN
      RAISE EXCEPTION 'SD_ASSERT_FAIL: canonical draft-sale insert returned no id';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_attribute
      WHERE attrelid = 'public.square_draft_sales'::regclass
        AND attname = 'keg_type_id'
        AND attnum > 0
        AND NOT attisdropped
    ) THEN
      RAISE EXCEPTION 'SD_ASSERT_FAIL: keg_type_id still exists';
    END IF;

    RAISE EXCEPTION 'SD_VERIFY_OK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'SD_VERIFY_OK' THEN
        RAISE NOTICE 'SD square_draft_sales verification passed (selling_format-only insert; legacy keg_type_id absent); test rows rolled back';
      ELSE
        RAISE EXCEPTION '%', SQLERRM;
      END IF;
  END;
END
$$;

NOTIFY pgrst, 'reload schema';
