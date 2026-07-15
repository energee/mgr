-- Atomic Square sale/refund ingestion (#443).
--
-- The webhook previously claimed a delivery, inserted one allocation, called a
-- separate bin RPC, repeated those statements per lot, and finalized the claim
-- in another request. A failure could therefore commit only half of a physical
-- movement, while stale-claim takeover replayed unknowable prior effects.
--
-- These service-role-only SECURITY INVOKER functions make the claim, every
-- ledger/bin/draft mutation, and claim finalization one PostgreSQL transaction.
-- Unexpected errors RAISE and roll everything back, so a retry either performs
-- the work once or observes the completed claim. Pre-migration stale claims are
-- never replayed: their possible side effects cannot be inferred safely, so
-- they are completed as durable manual-reconciliation records.
--
-- 00256 is already claimed by issue #434 / PR #468.

CREATE OR REPLACE FUNCTION ingest_square_sale_atomic(
  p_claim_key TEXT,
  p_event_id TEXT,
  p_order_id TEXT,
  p_payment_id TEXT,
  p_square_location_id TEXT,
  p_sold_at TIMESTAMPTZ,
  p_lines JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_claim square_sync_log%ROWTYPE;
  v_log_id UUID;
  v_bin_id UUID;
  v_location_id UUID;
  v_line_entry RECORD;
  v_line JSONB;
  v_line_uid TEXT;
  v_quantity_text TEXT;
  v_quantity_numeric NUMERIC;
  v_quantity INTEGER;
  v_unit_price_cents INTEGER;
  v_mapping RECORD;
  v_lot RECORD;
  v_remaining INTEGER;
  v_draw INTEGER;
  v_drawn INTEGER;
  v_bin_quantity_before INTEGER;
  v_has_physical_lot BOOLEAN;
  v_unit_fill_bbl NUMERIC;
  v_items_synced INTEGER := 0;
  v_items_failed INTEGER := 0;
  v_errors JSONB := '[]'::JSONB;
  v_warnings JSONB := '[]'::JSONB;
  v_oversold JSONB := '[]'::JSONB;
  v_details JSONB;
  v_retry_after INTEGER;
BEGIN
  IF p_claim_key IS NULL OR p_order_id IS NULL THEN
    RAISE EXCEPTION 'Square sale requires claim and order ids'
      USING ERRCODE = '22023';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'Square sale lines must be a JSON array'
      USING ERRCODE = '22023';
  END IF;

  -- Serialize every sale/refund transaction for one order, including the
  -- narrow race where a refund arrives before the sale's uncommitted claim is
  -- visible. Hash collisions only serialize unrelated orders; they cannot mix
  -- their data because all reads remain keyed by the full order id.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('square_order:' || p_order_id, 0)
  );

  -- Optimistic insert is the concurrency gate. A concurrent caller waits for
  -- the first transaction: after commit it observes duplicate; after rollback
  -- its own insert succeeds and safely performs the work.
  INSERT INTO square_sync_log (
    sync_type,
    event_id,
    square_payment_id,
    items_synced,
    items_failed,
    details
  )
  VALUES (
    'sale_ingest',
    p_event_id,
    p_claim_key,
    0,
    0,
    jsonb_build_object(
      'atomic_version', 1,
      'state', 'processing',
      'order_id', p_order_id,
      'payment_id', p_payment_id
    )
  )
  ON CONFLICT (square_payment_id) DO NOTHING
  RETURNING id INTO v_log_id;

  IF v_log_id IS NULL THEN
    SELECT * INTO v_claim
    FROM square_sync_log
    WHERE square_payment_id = p_claim_key
    FOR UPDATE;

    IF NOT FOUND THEN
      -- The conflicting owner rolled back between ON CONFLICT and this read.
      -- Raising makes Square retry; no side effect exists in this transaction.
      RAISE EXCEPTION 'Square sale claim disappeared; retry safely'
        USING ERRCODE = '40001';
    END IF;

    IF v_claim.completed_at IS NOT NULL THEN
      RETURN jsonb_build_object('kind', 'duplicate');
    END IF;

    IF v_claim.started_at >= now() - interval '15 minutes' THEN
      v_retry_after := GREATEST(
        1,
        CEIL(EXTRACT(EPOCH FROM (
          v_claim.started_at + interval '15 minutes' - now()
        )))::INTEGER
      );
      RETURN jsonb_build_object(
        'kind', 'in_flight',
        'retry_after_seconds', v_retry_after
      );
    END IF;

    -- A stale row committed before this atomic function existed may already
    -- have an allocation, bin debit, draft row, or none. Replaying is unsafe.
    UPDATE square_sync_log
    SET items_failed = GREATEST(items_failed, 1),
        details = COALESCE(details, '{}'::JSONB) || jsonb_build_object(
          'atomic_version', 1,
          'manual_reconcile', true,
          'error', 'Pre-atomic stale sale claim was not replayed because prior side effects are unknowable',
          'order_id', p_order_id,
          'payment_id', p_payment_id
        ),
        completed_at = now()
    WHERE id = v_claim.id;
    RETURN jsonb_build_object(
      'kind', 'manual_reconcile',
      'log_id', v_claim.id
    );
  END IF;

  IF p_square_location_id IS NOT NULL THEN
    SELECT id, location_id
    INTO v_bin_id, v_location_id
    FROM bins
    WHERE square_location_id = p_square_location_id;
  END IF;

  -- Canonical lock order shared with packaging revision: every affected
  -- finished_good first (UUID order), then every bin_inventory row (same UUID
  -- order). This prevents two different Square orders from deadlocking when
  -- their line-item order differs.
  IF v_bin_id IS NOT NULL THEN
    PERFORM fg.id
    FROM jsonb_array_elements(p_lines) AS line(value)
    JOIN square_catalog_map scm
      ON scm.square_catalog_id = line.value->>'catalog_object_id'
     AND scm.object_type = 'ITEM_VARIATION'
    JOIN selling_formats sf ON sf.id = scm.selling_format_id
    JOIN containers c ON c.id = sf.container_id AND c.type <> 'keg'
    JOIN finished_goods fg
      ON fg.brand_id = scm.brand_id
     AND fg.selling_format_id = scm.selling_format_id
    JOIN bin_inventory bi
      ON bi.finished_good_id = fg.id
     AND bi.bin_id = v_bin_id
    ORDER BY fg.id
    FOR UPDATE OF fg;

    PERFORM bi.id
    FROM jsonb_array_elements(p_lines) AS line(value)
    JOIN square_catalog_map scm
      ON scm.square_catalog_id = line.value->>'catalog_object_id'
     AND scm.object_type = 'ITEM_VARIATION'
    JOIN selling_formats sf ON sf.id = scm.selling_format_id
    JOIN containers c ON c.id = sf.container_id AND c.type <> 'keg'
    JOIN finished_goods fg
      ON fg.brand_id = scm.brand_id
     AND fg.selling_format_id = scm.selling_format_id
    JOIN bin_inventory bi
      ON bi.finished_good_id = fg.id
     AND bi.bin_id = v_bin_id
    ORDER BY fg.id
    FOR UPDATE OF bi;
  END IF;

  FOR v_line_entry IN
    SELECT value, ordinality
    FROM jsonb_array_elements(p_lines) WITH ORDINALITY
  LOOP
    v_line := v_line_entry.value;
    v_line_uid := COALESCE(
      NULLIF(v_line->>'uid', ''),
      'line-' || v_line_entry.ordinality::TEXT
    );

    IF NULLIF(v_line->>'catalog_object_id', '') IS NULL THEN
      CONTINUE;
    END IF;

    v_quantity_text := v_line->>'quantity';
    BEGIN
      v_quantity_numeric := v_quantity_text::NUMERIC;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      CONTINUE;
    END;
    IF v_quantity_numeric IS NULL OR v_quantity_numeric <= 0 THEN
      CONTINUE;
    END IF;
    IF v_quantity_numeric <> trunc(v_quantity_numeric)
       OR v_quantity_numeric > 2147483647 THEN
      v_items_failed := v_items_failed + 1;
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'lineItemUid', v_line_uid,
        'error', format(
          'Non-integer quantity "%s" — cannot debit fractional units',
          COALESCE(v_quantity_text, '(missing)')
        )
      ));
      CONTINUE;
    END IF;
    v_quantity := v_quantity_numeric::INTEGER;
    BEGIN
      v_unit_price_cents := COALESCE((v_line->>'unit_price_cents')::INTEGER, 0);
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      v_unit_price_cents := 0;
    END;

    BEGIN
      SELECT
        scm.id,
        scm.brand_id,
        scm.selling_format_id,
        scm.pour_size_oz,
        sf.unit_count,
        c.type AS container_type,
        c.volume_bbl,
        c.volume_oz
      INTO STRICT v_mapping
      FROM square_catalog_map scm
      LEFT JOIN selling_formats sf ON sf.id = scm.selling_format_id
      LEFT JOIN containers c ON c.id = sf.container_id
      WHERE scm.square_catalog_id = v_line->>'catalog_object_id'
        AND scm.object_type = 'ITEM_VARIATION';
    EXCEPTION
      WHEN no_data_found THEN
        -- Square can sell non-MGR products. An absent mapping is intentionally
        -- ignored rather than recorded as a failed inventory mutation.
        CONTINUE;
      WHEN too_many_rows THEN
        v_items_failed := v_items_failed + 1;
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'lineItemUid', v_line_uid,
          'error', format(
            'Square catalog object %s has multiple MGR mappings',
            v_line->>'catalog_object_id'
          )
        ));
        CONTINUE;
    END;

    IF v_mapping.selling_format_id IS NULL
       OR v_mapping.container_type IS NULL THEN
      v_items_failed := v_items_failed + 1;
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'lineItemUid', v_line_uid,
        'error', format(
          'Catalog mapping %s has no linked container type',
          v_mapping.id
        )
      ));
      CONTINUE;
    END IF;

    IF v_mapping.container_type = 'keg' THEN
      IF v_location_id IS NULL THEN
        v_items_failed := v_items_failed + 1;
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'lineItemUid', v_line_uid,
          'error', format(
            'Draft sale requires a mapped location but Square location %s is not mapped to a POS bin',
            COALESCE(p_square_location_id, '(none)')
          )
        ));
        CONTINUE;
      END IF;

      INSERT INTO square_draft_sales (
        square_order_id,
        square_payment_id,
        brand_id,
        selling_format_id,
        quantity,
        volume_oz,
        unit_price_cents,
        location_id,
        sold_at
      )
      VALUES (
        p_order_id,
        p_payment_id,
        v_mapping.brand_id,
        v_mapping.selling_format_id,
        v_quantity,
        v_quantity * COALESCE(v_mapping.pour_size_oz, 16),
        v_unit_price_cents,
        v_location_id,
        COALESCE(p_sold_at, now())
      )
      ON CONFLICT (square_order_id, brand_id, selling_format_id)
      DO UPDATE SET
        quantity = square_draft_sales.quantity + EXCLUDED.quantity,
        volume_oz = COALESCE(square_draft_sales.volume_oz, 0)
          + COALESCE(EXCLUDED.volume_oz, 0),
        unit_price_cents = EXCLUDED.unit_price_cents;
      v_items_synced := v_items_synced + 1;
      CONTINUE;
    END IF;

    IF v_bin_id IS NULL THEN
      v_items_failed := v_items_failed + 1;
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'lineItemUid', v_line_uid,
        'error', format(
          'Square location %s is not mapped to a POS bin',
          COALESCE(p_square_location_id, '(none)')
        )
      ));
      CONTINUE;
    END IF;

    v_unit_fill_bbl := CASE
      WHEN v_mapping.volume_bbl IS NOT NULL AND v_mapping.volume_bbl > 0
        THEN v_mapping.volume_bbl * COALESCE(v_mapping.unit_count, 1)
      WHEN v_mapping.volume_oz IS NOT NULL AND v_mapping.volume_oz > 0
        THEN (v_mapping.volume_oz / 3968.0) * COALESCE(v_mapping.unit_count, 1)
      ELSE NULL
    END;
    IF v_unit_fill_bbl IS NULL THEN
      v_warnings := v_warnings || jsonb_build_array(format(
        'Line %s (selling format %s) has no container volume; allocation.volume_bbl left null',
        v_line_uid,
        v_mapping.selling_format_id
      ));
    END IF;

    v_remaining := v_quantity;
    v_drawn := 0;
    v_bin_quantity_before := 0;
    v_has_physical_lot := false;

    FOR v_lot IN
      SELECT
        fg.id AS finished_good_id,
        bi.quantity AS physical_quantity,
        LEAST(
          bi.quantity,
          GREATEST(
            0,
            fg.quantity - COALESCE((
              SELECT SUM(a.quantity)
              FROM allocations a
              WHERE a.source_type = 'finished_good'
                AND a.source_id = fg.id
                AND a.status IN ('planned', 'completed')
            ), 0)
          )
        )::INTEGER AS available_quantity
      FROM finished_goods fg
      JOIN bin_inventory bi
        ON bi.finished_good_id = fg.id
       AND bi.bin_id = v_bin_id
      WHERE fg.brand_id = v_mapping.brand_id
        AND fg.selling_format_id = v_mapping.selling_format_id
        AND bi.quantity > 0
      ORDER BY fg.production_date NULLS LAST, fg.id
    LOOP
      v_has_physical_lot := true;
      v_bin_quantity_before := v_bin_quantity_before + v_lot.physical_quantity;
      IF v_remaining <= 0 OR v_lot.available_quantity <= 0 THEN
        CONTINUE;
      END IF;

      v_draw := LEAST(v_remaining, v_lot.available_quantity);
      INSERT INTO allocations (
        source_type,
        source_id,
        destination_type,
        destination_id,
        quantity,
        volume_bbl,
        reason_code,
        status,
        completed_at,
        notes,
        idempotency_key
      )
      VALUES (
        'finished_good',
        v_lot.finished_good_id,
        'taproom_sale',
        NULL,
        v_draw,
        CASE WHEN v_unit_fill_bbl IS NULL
          THEN NULL
          ELSE v_unit_fill_bbl * v_draw
        END,
        'other',
        'completed',
        COALESCE(p_sold_at, now()),
        'Square order ' || p_order_id,
        format(
          'square_sale:%s:%s:%s',
          p_order_id,
          v_line_uid,
          v_lot.finished_good_id
        )
      );

      UPDATE bin_inventory
      SET quantity = quantity - v_draw
      WHERE bin_id = v_bin_id
        AND finished_good_id = v_lot.finished_good_id;

      v_drawn := v_drawn + v_draw;
      v_remaining := v_remaining - v_draw;
    END LOOP;

    IF NOT v_has_physical_lot OR v_drawn = 0 THEN
      v_items_failed := v_items_failed + 1;
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'lineItemUid', v_line_uid,
        'error', format(
          'No finished good with available inventory in bin %s for brand %s / selling format %s',
          v_bin_id,
          v_mapping.brand_id,
          v_mapping.selling_format_id
        )
      ));
      CONTINUE;
    END IF;

    IF v_remaining > 0 THEN
      v_oversold := v_oversold || jsonb_build_array(jsonb_build_object(
        'lineItemUid', v_line_uid,
        'brandId', v_mapping.brand_id,
        'sellingFormatId', v_mapping.selling_format_id,
        'soldQty', v_quantity,
        'binQuantityBefore', v_bin_quantity_before,
        'shortfallQty', v_remaining
      ));
    END IF;
    v_items_synced := v_items_synced + 1;
  END LOOP;

  v_details := jsonb_build_object(
    'atomic_version', 1,
    'order_id', p_order_id,
    'payment_id', p_payment_id,
    'square_location_id', p_square_location_id,
    'line_item_count', jsonb_array_length(p_lines)
  );
  IF jsonb_array_length(v_errors) > 0 THEN
    v_details := v_details || jsonb_build_object('errors', v_errors);
  END IF;
  IF jsonb_array_length(v_warnings) > 0 THEN
    v_details := v_details || jsonb_build_object('warnings', v_warnings);
  END IF;
  IF jsonb_array_length(v_oversold) > 0 THEN
    v_details := v_details || jsonb_build_object('oversoldLines', v_oversold);
  END IF;

  -- Finalization is intentionally fatal now: any error rolls the claim and all
  -- preceding mutations back in the same statement.
  UPDATE square_sync_log
  SET location_id = v_location_id,
      items_synced = v_items_synced,
      items_failed = v_items_failed,
      details = v_details,
      completed_at = now()
  WHERE id = v_log_id;

  RETURN jsonb_build_object(
    'kind', 'processed',
    'log_id', v_log_id,
    'items_synced', v_items_synced,
    'items_failed', v_items_failed,
    'oversold_lines', v_oversold
  );
END;
$$;

COMMENT ON FUNCTION ingest_square_sale_atomic(
  TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, JSONB
) IS
  'Atomically claims and ingests one Square order: resolves local mappings, FIFO-locks finished goods and bin rows, records TTB allocations or draft sales, debits physical bins, and finalizes square_sync_log. Unexpected failures roll back every effect; completed claims deduplicate retries; stale pre-atomic claims are finalized for manual reconciliation instead of replayed. SECURITY INVOKER and service_role-only.';

REVOKE ALL ON FUNCTION ingest_square_sale_atomic(
  TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ingest_square_sale_atomic(
  TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, JSONB
) TO service_role;

CREATE OR REPLACE FUNCTION ingest_square_refund_atomic(
  p_refund_id TEXT,
  p_event_id TEXT,
  p_order_id TEXT,
  p_payment_id TEXT,
  p_square_location_id TEXT,
  p_refunded_at TIMESTAMPTZ,
  p_refund_amount BIGINT,
  p_order_total BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_sale_claim square_sync_log%ROWTYPE;
  v_refund_claim square_sync_log%ROWTYPE;
  v_log_id UUID;
  v_bin_id UUID;
  v_location_id UUID;
  v_alloc RECORD;
  v_reversed_qty INTEGER;
  v_reversed_volume NUMERIC;
  v_proportion NUMERIC;
  v_is_full BOOLEAN;
  v_items_synced INTEGER := 0;
  v_items_failed INTEGER := 0;
  v_draft_count INTEGER := 0;
  v_draft_voided INTEGER := 0;
  v_errors JSONB := '[]'::JSONB;
  v_warnings JSONB := '[]'::JSONB;
  v_reversals JSONB := '[]'::JSONB;
  v_details JSONB;
  v_retry_after INTEGER;
BEGIN
  IF p_refund_id IS NULL OR p_order_id IS NULL THEN
    RAISE EXCEPTION 'Square refund requires refund and order ids'
      USING ERRCODE = '22023';
  END IF;

  -- Match the sale function's first lock so a concurrently committing sale is
  -- visible before this function decides whether the order was ingested.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('square_order:' || p_order_id, 0)
  );

  -- Lock the sale before the refund claim. Every refund of one order follows
  -- this order, so distinct partial refunds serialize when sizing/reversing.
  SELECT * INTO v_sale_claim
  FROM square_sync_log
  WHERE sync_type = 'sale_ingest'
    AND square_payment_id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('kind', 'ignored');
  END IF;

  IF v_sale_claim.completed_at IS NULL THEN
    IF v_sale_claim.started_at >= now() - interval '15 minutes' THEN
      v_retry_after := GREATEST(
        1,
        CEIL(EXTRACT(EPOCH FROM (
          v_sale_claim.started_at + interval '15 minutes' - now()
        )))::INTEGER
      );
      RETURN jsonb_build_object(
        'kind', 'in_flight',
        'retry_after_seconds', v_retry_after
      );
    END IF;

    UPDATE square_sync_log
    SET items_failed = GREATEST(items_failed, 1),
        details = COALESCE(details, '{}'::JSONB) || jsonb_build_object(
          'atomic_version', 1,
          'manual_reconcile', true,
          'error', 'Pre-atomic stale sale claim blocks automatic refund reversal because prior sale effects are unknowable'
        ),
        completed_at = now()
    WHERE id = v_sale_claim.id;
    v_sale_claim.details := COALESCE(v_sale_claim.details, '{}'::JSONB)
      || jsonb_build_object('manual_reconcile', true);
  END IF;

  INSERT INTO square_sync_log (
    sync_type,
    event_id,
    square_payment_id,
    items_synced,
    items_failed,
    details
  )
  VALUES (
    'refund_ingest',
    p_event_id,
    p_refund_id,
    0,
    0,
    jsonb_build_object(
      'atomic_version', 1,
      'state', 'processing',
      'refund_id', p_refund_id,
      'order_id', p_order_id,
      'payment_id', p_payment_id
    )
  )
  ON CONFLICT (square_payment_id) DO NOTHING
  RETURNING id INTO v_log_id;

  IF v_log_id IS NULL THEN
    SELECT * INTO v_refund_claim
    FROM square_sync_log
    WHERE square_payment_id = p_refund_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Square refund claim disappeared; retry safely'
        USING ERRCODE = '40001';
    END IF;
    IF v_refund_claim.completed_at IS NOT NULL THEN
      RETURN jsonb_build_object('kind', 'duplicate');
    END IF;
    IF v_refund_claim.started_at >= now() - interval '15 minutes' THEN
      v_retry_after := GREATEST(
        1,
        CEIL(EXTRACT(EPOCH FROM (
          v_refund_claim.started_at + interval '15 minutes' - now()
        )))::INTEGER
      );
      RETURN jsonb_build_object(
        'kind', 'in_flight',
        'retry_after_seconds', v_retry_after
      );
    END IF;

    UPDATE square_sync_log
    SET items_failed = GREATEST(items_failed, 1),
        details = COALESCE(details, '{}'::JSONB) || jsonb_build_object(
          'atomic_version', 1,
          'manual_reconcile', true,
          'error', 'Pre-atomic stale refund claim was not replayed because prior reversal effects are unknowable',
          'refund_id', p_refund_id,
          'order_id', p_order_id
        ),
        completed_at = now()
    WHERE id = v_refund_claim.id;
    RETURN jsonb_build_object(
      'kind', 'manual_reconcile',
      'log_id', v_refund_claim.id
    );
  END IF;

  -- A sale already classified as unknowable cannot be reversed automatically.
  IF COALESCE((v_sale_claim.details->>'manual_reconcile')::BOOLEAN, false) THEN
    UPDATE square_sync_log
    SET items_failed = 1,
        details = jsonb_build_object(
          'atomic_version', 1,
          'manual_reconcile', true,
          'refund_id', p_refund_id,
          'order_id', p_order_id,
          'error', 'Refund requires manual reconciliation because its sale claim has unknowable pre-atomic effects'
        ),
        completed_at = now()
    WHERE id = v_log_id;
    RETURN jsonb_build_object(
      'kind', 'manual_reconcile',
      'log_id', v_log_id
    );
  END IF;

  IF p_square_location_id IS NOT NULL THEN
    SELECT id, location_id
    INTO v_bin_id, v_location_id
    FROM bins
    WHERE square_location_id = p_square_location_id;
  END IF;

  -- Same canonical lock order as sales and packaging revision.
  PERFORM fg.id
  FROM allocations a
  JOIN finished_goods fg ON fg.id = a.source_id
  WHERE a.source_type = 'finished_good'
    AND a.destination_type = 'taproom_sale'
    AND a.status = 'completed'
    AND a.notes = 'Square order ' || p_order_id
  ORDER BY fg.id
  FOR UPDATE OF fg;

  IF v_bin_id IS NOT NULL THEN
    PERFORM bi.id
    FROM allocations a
    JOIN bin_inventory bi
      ON bi.finished_good_id = a.source_id
     AND bi.bin_id = v_bin_id
    WHERE a.source_type = 'finished_good'
      AND a.destination_type = 'taproom_sale'
      AND a.status = 'completed'
      AND a.notes = 'Square order ' || p_order_id
    ORDER BY bi.finished_good_id
    FOR UPDATE OF bi;
  END IF;

  v_is_full := p_order_total IS NOT NULL
    AND p_order_total > 0
    AND p_refund_amount IS NOT NULL
    AND p_refund_amount >= p_order_total;
  v_proportion := CASE
    WHEN p_order_total IS NOT NULL AND p_order_total > 0
      AND p_refund_amount IS NOT NULL AND p_refund_amount > 0
      THEN LEAST(1::NUMERIC, p_refund_amount::NUMERIC / p_order_total::NUMERIC)
    ELSE NULL
  END;

  IF v_proportion IS NULL THEN
    v_items_failed := 1;
    v_errors := jsonb_build_array(jsonb_build_object(
      'item', 'sizing',
      'error', format(
        'Cannot size refund reversal: refund amount %s vs order total %s; reverse manually from this log entry',
        COALESCE(p_refund_amount::TEXT, '(missing)'),
        COALESCE(p_order_total::TEXT, '(missing)')
      )
    ));
  ELSE
    FOR v_alloc IN
      SELECT id, source_id, quantity, volume_bbl
      FROM allocations
      WHERE source_type = 'finished_good'
        AND destination_type = 'taproom_sale'
        AND status = 'completed'
        AND notes = 'Square order ' || p_order_id
      ORDER BY id
    LOOP
      IF v_alloc.source_id IS NULL THEN
        RAISE EXCEPTION 'Original Square allocation % has no finished-good source',
          v_alloc.id;
      END IF;

      v_reversed_qty := CASE
        WHEN v_is_full THEN v_alloc.quantity::INTEGER
        ELSE floor(v_alloc.quantity * v_proportion)::INTEGER
      END;
      IF v_reversed_qty <= 0 THEN
        v_warnings := v_warnings || jsonb_build_array(format(
          'Allocation %s: proportional reversal floored to zero; nothing reversed for this lot draw',
          v_alloc.id
        ));
        CONTINUE;
      END IF;

      v_reversed_volume := CASE
        WHEN v_alloc.volume_bbl IS NULL OR v_alloc.quantity <= 0 THEN NULL
        ELSE -((v_alloc.volume_bbl / v_alloc.quantity) * v_reversed_qty)
      END;
      IF v_reversed_volume IS NULL THEN
        v_warnings := v_warnings || jsonb_build_array(format(
          'Allocation %s has no volume_bbl; reversal volume left null',
          v_alloc.id
        ));
      END IF;

      INSERT INTO allocations (
        source_type,
        source_id,
        destination_type,
        destination_id,
        quantity,
        volume_bbl,
        reason_code,
        status,
        completed_at,
        notes,
        idempotency_key
      )
      VALUES (
        'finished_good',
        v_alloc.source_id,
        'adjustment',
        NULL,
        -v_reversed_qty,
        v_reversed_volume,
        'refund',
        'completed',
        COALESCE(p_refunded_at, now()),
        format('Square refund %s of order %s', p_refund_id, p_order_id),
        format('square_refund:%s:%s', p_refund_id, v_alloc.id)
      );

      IF v_bin_id IS NOT NULL THEN
        INSERT INTO bin_inventory (finished_good_id, bin_id, quantity)
        VALUES (v_alloc.source_id, v_bin_id, v_reversed_qty)
        ON CONFLICT (finished_good_id, bin_id)
        DO UPDATE SET quantity = bin_inventory.quantity + EXCLUDED.quantity;
      ELSE
        v_warnings := v_warnings || jsonb_build_array(format(
          'Square location %s is not mapped to a POS bin; ledger reversed for allocation %s but no bin credited',
          COALESCE(p_square_location_id, '(none)'),
          v_alloc.id
        ));
      END IF;

      v_reversals := v_reversals || jsonb_build_array(jsonb_build_object(
        'allocationId', v_alloc.id,
        'finishedGoodId', v_alloc.source_id,
        'reversedQuantity', v_reversed_qty,
        'reversedVolumeBbl', v_reversed_volume
      ));
      v_items_synced := v_items_synced + 1;
    END LOOP;

    SELECT count(*) INTO v_draft_count
    FROM square_draft_sales
    WHERE square_order_id = p_order_id
      AND voided_at IS NULL;

    IF v_draft_count > 0 THEN
      IF v_is_full THEN
        UPDATE square_draft_sales
        SET voided_at = now()
        WHERE square_order_id = p_order_id
          AND voided_at IS NULL;
        GET DIAGNOSTICS v_draft_voided = ROW_COUNT;
      ELSE
        v_warnings := v_warnings || jsonb_build_array(format(
          'Partial refund: %s staged draft row(s) left un-voided for manual review',
          v_draft_count
        ));
      END IF;
    END IF;
  END IF;

  v_details := jsonb_build_object(
    'atomic_version', 1,
    'refund_id', p_refund_id,
    'order_id', p_order_id,
    'payment_id', p_payment_id,
    'square_location_id', p_square_location_id,
    'refund_amount', p_refund_amount,
    'order_total', p_order_total,
    'proportional', v_proportion IS NOT NULL AND NOT v_is_full
  );
  IF v_proportion IS NOT NULL AND NOT v_is_full THEN
    v_details := v_details || jsonb_build_object(
      'proportion', round(v_proportion, 6)
    );
  END IF;
  IF jsonb_array_length(v_reversals) > 0 THEN
    v_details := v_details || jsonb_build_object('reversals', v_reversals);
  END IF;
  IF v_draft_voided > 0 THEN
    v_details := v_details || jsonb_build_object('draft_rows_voided', v_draft_voided);
  END IF;
  IF jsonb_array_length(v_errors) > 0 THEN
    v_details := v_details || jsonb_build_object('errors', v_errors);
  END IF;
  IF jsonb_array_length(v_warnings) > 0 THEN
    v_details := v_details || jsonb_build_object('warnings', v_warnings);
  END IF;

  UPDATE square_sync_log
  SET location_id = v_location_id,
      items_synced = v_items_synced,
      items_failed = v_items_failed,
      details = v_details,
      completed_at = now()
  WHERE id = v_log_id;

  RETURN jsonb_build_object(
    'kind', 'processed',
    'log_id', v_log_id,
    'items_synced', v_items_synced,
    'items_failed', v_items_failed
  );
END;
$$;

COMMENT ON FUNCTION ingest_square_refund_atomic(
  TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, BIGINT, BIGINT
) IS
  'Atomically claims and ingests one Square refund: locks the completed sale, writes inverse TTB allocations, credits physical bins, voids full-refund draft rows, and finalizes square_sync_log. Unexpected failures roll back every effect; refund-id retries deduplicate; stale pre-atomic claims are finalized for manual reconciliation instead of replayed. SECURITY INVOKER and service_role-only.';

REVOKE ALL ON FUNCTION ingest_square_refund_atomic(
  TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, BIGINT, BIGINT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ingest_square_refund_atomic(
  TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, BIGINT, BIGINT
) TO service_role;

NOTIFY pgrst, 'reload schema';
