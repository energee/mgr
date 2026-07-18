-- Quarantine order-total-mismatch refund logs so they stop poisoning later
-- automatic reversals (#547).
--
-- 00262 fails a refund whose reported order total differs from the totals
-- recorded by prior completed refund logs, because mixing totals makes
-- cumulative sizing unsafe. But the failed log itself was written as a plain
-- completed refund log carrying its divergent order_total, so every later
-- refund — including ones whose total matches the effective history — tripped
-- the same mismatch check forever. One bad webhook payload permanently blocked
-- automatic reversals for the order.
--
-- Fix: mark the mismatch-failure log `manual_reconcile: true`. The prior-log
-- aggregation already excludes manual-reconcile records, so the quarantined
-- log no longer contributes its divergent order_total to the mismatch check
-- nor its never-applied refund_amount to the cumulative sum (which would have
-- over-credited bins). Recovery is therefore automatic: the mismatch check is
-- re-evaluated per attempt against effective logs only, so the next refund
-- with a consistent total sizes normally. The mismatched refund itself stays a
-- sealed manual-reconcile audit record — its inventory effect must be applied
-- manually from the sync log, exactly as the recorded error instructs; a
-- retry of the same refund id still reports 'duplicate'.

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
  v_target_reversed_qty INTEGER;
  v_already_reversed_qty INTEGER;
  v_reversed_qty INTEGER;
  v_reversed_volume NUMERIC;
  v_event_proportion NUMERIC;
  v_prior_refund_amount NUMERIC := 0;
  v_cumulative_refund_amount NUMERIC;
  v_cumulative_proportion NUMERIC;
  v_order_total_mismatches INTEGER := 0;
  v_manual_reconcile BOOLEAN := false;
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

  -- Sales and every refund for one Square order take this transaction lock.
  -- It makes the completed prior-refund set stable while the cumulative delta
  -- is calculated and written.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('square_order:' || p_order_id, 0)
  );

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
          'atomic_version', 2,
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
      'atomic_version', 2,
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
          'atomic_version', 2,
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

  IF COALESCE((v_sale_claim.details->>'manual_reconcile')::BOOLEAN, false) THEN
    UPDATE square_sync_log
    SET items_failed = 1,
        details = jsonb_build_object(
          'atomic_version', 2,
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

  -- Keep the canonical lock order shared with sale ingestion and packaging
  -- revision: finished goods first, then bin rows, each in UUID order.
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

  v_event_proportion := CASE
    WHEN p_order_total IS NOT NULL AND p_order_total > 0
      AND p_refund_amount IS NOT NULL AND p_refund_amount > 0
      THEN LEAST(1::NUMERIC, p_refund_amount::NUMERIC / p_order_total::NUMERIC)
    ELSE NULL
  END;

  IF v_event_proportion IS NULL THEN
    -- Refund cannot be sized (missing/zero order total or refund amount). Raise
    -- so the whole transaction — including the refund_ingest claim row inserted
    -- this transaction — rolls back. Sizing happens before any allocation/bin
    -- writes, so rollback leaves no partial effects and a later retry (after the
    -- source data is corrected) starts cleanly rather than hitting a sealed,
    -- falsely 'duplicate' completed log.
    RAISE EXCEPTION 'Cannot size Square refund reversal: refund amount %, order total %; correct the source data and retry',
      COALESCE(p_refund_amount::TEXT, '(missing)'),
      COALESCE(p_order_total::TEXT, '(missing)')
      USING ERRCODE = '22023';
  ELSE
    -- Completed refund logs are the durable per-event audit ledger. Include
    -- prior valid amounts even when a historical event only reversed some
    -- allocations: its reversals array below records the exact applied units,
    -- so this event can catch up the missing delta without double-crediting.
    -- Manual-reconcile records are excluded: they applied no reversals, and
    -- since 00267 that set includes quarantined order-total-mismatch failures,
    -- whose divergent totals and never-applied amounts must not participate in
    -- sizing.
    SELECT
      COALESCE(SUM(
        CASE
          WHEN details->>'refund_amount' ~ '^[0-9]+$'
            THEN (details->>'refund_amount')::NUMERIC
          ELSE 0
        END
      ), 0),
      COUNT(*) FILTER (
        WHERE details->>'order_total' ~ '^[0-9]+$'
          AND (details->>'order_total')::BIGINT <> p_order_total
      )::INTEGER
    INTO v_prior_refund_amount, v_order_total_mismatches
    FROM square_sync_log
    WHERE sync_type = 'refund_ingest'
      AND completed_at IS NOT NULL
      AND details->>'order_id' = p_order_id
      AND NOT COALESCE((details->>'manual_reconcile')::BOOLEAN, false);

    IF v_order_total_mismatches > 0 THEN
      -- This event's reported total disagrees with the effective refund
      -- history, so it cannot be sized safely. Fail it durably as a
      -- manual-reconcile record (#547): quarantining it keeps its divergent
      -- order_total out of future mismatch checks, so later refunds with
      -- consistent totals size automatically instead of being blocked forever.
      v_items_failed := 1;
      v_manual_reconcile := true;
      v_errors := jsonb_build_array(jsonb_build_object(
        'item', 'sizing',
        'error', 'Prior effective refunds for this Square order recorded a different order total; reverse this refund manually from the sync log. Later refunds with consistent totals proceed automatically.'
      ));
    ELSE
      v_cumulative_refund_amount := LEAST(
        p_order_total::NUMERIC,
        v_prior_refund_amount + p_refund_amount::NUMERIC
      );
      v_cumulative_proportion := LEAST(
        1::NUMERIC,
        v_cumulative_refund_amount / p_order_total::NUMERIC
      );
      v_is_full := v_cumulative_refund_amount >= p_order_total;

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

        v_target_reversed_qty := CASE
          WHEN v_is_full THEN v_alloc.quantity::INTEGER
          ELSE floor(v_alloc.quantity * v_cumulative_proportion)::INTEGER
        END;

        SELECT COALESCE(SUM((reversal.value->>'reversedQuantity')::INTEGER), 0)
        INTO v_already_reversed_qty
        FROM square_sync_log prior_log
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(prior_log.details->'reversals') = 'array'
              THEN prior_log.details->'reversals'
            ELSE '[]'::JSONB
          END
        ) AS reversal(value)
        WHERE prior_log.sync_type = 'refund_ingest'
          AND prior_log.completed_at IS NOT NULL
          AND prior_log.details->>'order_id' = p_order_id
          AND reversal.value->>'allocationId' = v_alloc.id::TEXT
          AND reversal.value->>'reversedQuantity' ~ '^[0-9]+$';

        v_reversed_qty := v_target_reversed_qty - v_already_reversed_qty;
        IF v_reversed_qty <= 0 THEN
          v_warnings := v_warnings || jsonb_build_array(format(
            'Allocation %s: cumulative target %s already satisfied by %s reversed unit(s); nothing added for this refund',
            v_alloc.id,
            v_target_reversed_qty,
            v_already_reversed_qty
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
          'previouslyReversedQuantity', v_already_reversed_qty,
          'cumulativeTargetQuantity', v_target_reversed_qty,
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
            'Cumulative partial refund: %s staged draft row(s) left un-voided for manual review',
            v_draft_count
          ));
        END IF;
      END IF;
    END IF;
  END IF;

  v_details := jsonb_build_object(
    'atomic_version', 2,
    'refund_id', p_refund_id,
    'order_id', p_order_id,
    'payment_id', p_payment_id,
    'square_location_id', p_square_location_id,
    'refund_amount', p_refund_amount,
    'prior_refund_amount', v_prior_refund_amount,
    'cumulative_refund_amount', v_cumulative_refund_amount,
    'order_total', p_order_total,
    'proportional', v_event_proportion IS NOT NULL
      AND v_event_proportion < 1
  );
  IF v_manual_reconcile THEN
    -- Quarantine marker (#547): manual-reconcile refund logs are excluded from
    -- the prior-log aggregation above, so this failed event cannot poison the
    -- sizing of later refunds.
    v_details := v_details || jsonb_build_object('manual_reconcile', true);
  END IF;
  IF v_event_proportion IS NOT NULL THEN
    v_details := v_details || jsonb_build_object(
      'proportion', round(v_event_proportion, 6)
    );
  END IF;
  IF v_cumulative_proportion IS NOT NULL THEN
    v_details := v_details || jsonb_build_object(
      'cumulative_proportion', round(v_cumulative_proportion, 6),
      'cumulative_full', v_is_full
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
  'Atomically claims and ingests one Square refund: serializes by order, calculates each sale allocation cumulative refund target, applies only the unreversed delta, credits physical bins, voids cumulatively full-refund draft rows, and finalizes square_sync_log. Unexpected failures roll back every effect; refund-id retries deduplicate; stale pre-atomic claims remain manual-reconciliation records. Order-total-mismatch refunds fail as quarantined manual-reconcile records that never block later consistent refunds (#547). SECURITY INVOKER and service_role-only.';

REVOKE ALL ON FUNCTION ingest_square_refund_atomic(
  TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, BIGINT, BIGINT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ingest_square_refund_atomic(
  TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, BIGINT, BIGINT
) TO service_role;

NOTIFY pgrst, 'reload schema';
