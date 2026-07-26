-- Square refund reversal: cover already-reconciled draft keg pours (#606) and
-- stop dropping refunds that arrive before their sale (#607).
--
-- Everything not called out below is carried forward verbatim from 00268.
--
-- #606 — two independent defects made a refund a silent no-op for keg pours
-- that the manual reconciler had already converted into TTB removals:
--
--   1. The reversal predicate matched `notes = 'Square order <id>'`, which only
--      the webhook's PACKAGED path writes. The draft path stages a
--      square_draft_sales row at sale time and creates no allocation; the
--      reconciler (POST /api/square/reconcile-draft-sales) later writes the
--      allocation with `notes = 'Square draft sale reconciliation (order <id>)'`
--      and the stable idempotency key `square_draft_sale:<draft id>`. Zero rows
--      matched, yet the draft-void block still stamped voided_at and the log
--      still reported draft_rows_voided — the refund looked fully handled while
--      the pour stayed counted as a taxpaid removal and the keg lot stayed
--      drawn down.
--
--      Fix: select sale allocations by the packaged note OR by a structural
--      join through square_draft_sales.square_order_id on that idempotency key.
--      Matching the key rather than restyling the reconciler's note repairs
--      rows that already exist and survives future wording changes.
--
--   2. The reversal quantities were declared INTEGER while allocations.quantity
--      is NUMERIC(10,4) and the reconciler stores FRACTIONAL kegs (a 12 oz pour
--      from a half-barrel is ~0.006 kegs). `::INTEGER` floored every draft draw
--      to 0 and the loop took its `<= 0` early exit.
--
--      Fix: the three quantity variables become NUMERIC and the casts go away.
--      Packaged allocations keep floor() — cans and cases are discrete, and a
--      partial refund must never over-reverse a whole unit. Draft-origin
--      allocations round at scale 4 instead (the column's scale), because a
--      pour is a continuous draw and flooring it is exactly the bug. The
--      cumulative catch-up in `already reversed` therefore also had to accept
--      decimal strings, not just `^[0-9]+$`.
--
--   Draft-origin rows additionally skip the bin_inventory credit and its
--   unmapped-POS-bin warning: the keg sale path never debited a bin
--   (00257 CONTINUEs before the bin block), so crediting one would invent
--   stock. And the draft-void block now only voids a RECONCILED row whose
--   reconciliation allocation this refund actually reversed, so
--   draft_rows_voided can no longer imply a reversal that did not happen.
--
-- #607 — a COMPLETED refund whose sale_ingest claim does not exist YET returned
--   kind='ignored' before inserting its own claim row, so the route 200-acked
--   it and Square never redelivered. Because PAYMENT_REPLAY_WINDOW_MS is 25 h
--   specifically so a still-retrying payment is accepted late, a refund can
--   legitimately overtake its sale; the reversal was then lost forever.
--
--   Fix: record the outcome durably (a completed refund_ingest claim with
--   items_failed = 1 and details.state = 'sale_missing') and return
--   kind='sale_missing' with retry_after_seconds so the route can 503 and let
--   Square redeliver. items_failed = 1 keeps the row out of the cumulative
--   monetary ledger (#547), so it cannot poison later sizing. When a later
--   delivery finds the sale present, the deferred claim is RE-OPENED rather
--   than reported as a duplicate, and the reversal applies on that delivery.
--   Exactly one claim row per refund id throughout, so #443's exactly-once
--   property is unchanged.

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
  -- NUMERIC, not INTEGER (#606): allocations.quantity is NUMERIC(10,4) and a
  -- reconciled draft pour is a fraction of a keg.
  v_target_reversed_qty NUMERIC;
  v_already_reversed_qty NUMERIC;
  v_reversed_qty NUMERIC;
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
  -- Draft rows whose reconciliation allocation this event actually reversed;
  -- gates the void block so a reconciled row is never retired without an
  -- offsetting allocation (#606).
  v_reversed_draft_ids UUID[] := ARRAY[]::UUID[];
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
    -- #607: "no sale here" and "no sale here YET" are not the same outcome.
    -- Record the refund durably so it is visible in square_sync_log and on the
    -- sync-status panel, then ask the caller to have Square redeliver.
    -- items_failed = 1 keeps this record inert in the cumulative monetary
    -- ledger below (#547) until it is re-opened and completed for real.
    INSERT INTO square_sync_log (
      sync_type,
      event_id,
      square_payment_id,
      items_synced,
      items_failed,
      details,
      completed_at
    )
    VALUES (
      'refund_ingest',
      p_event_id,
      p_refund_id,
      0,
      1,
      jsonb_build_object(
        'atomic_version', 2,
        'state', 'sale_missing',
        'manual_reconcile', true,
        'error', 'Square sale for this order has not been ingested yet; reversal deferred until it is',
        'refund_id', p_refund_id,
        'order_id', p_order_id,
        'payment_id', p_payment_id
      ),
      now()
    )
    ON CONFLICT (square_payment_id) DO NOTHING;

    RETURN jsonb_build_object(
      'kind', 'sale_missing',
      'retry_after_seconds', 900
    );
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
      IF COALESCE(v_refund_claim.details->>'state', '') = 'sale_missing' THEN
        -- #607: this refund was deferred because its sale had not landed. It
        -- has now (checked above), so re-open the deferred record instead of
        -- reporting a duplicate, and apply the reversal on this delivery.
        UPDATE square_sync_log
        SET items_failed = 0,
            items_synced = 0,
            started_at = now(),
            completed_at = NULL,
            details = jsonb_build_object(
              'atomic_version', 2,
              'state', 'processing',
              'refund_id', p_refund_id,
              'order_id', p_order_id,
              'payment_id', p_payment_id
            )
        WHERE id = v_refund_claim.id;
        v_log_id := v_refund_claim.id;
      ELSE
        RETURN jsonb_build_object('kind', 'duplicate');
      END IF;
    ELSIF v_refund_claim.started_at >= now() - interval '15 minutes' THEN
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
    ELSE
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
  -- revision: finished goods first, then bin rows, each in UUID order. The
  -- EXISTS arm is the draft-origin selector added by #606 — it must be part of
  -- the lock scans too, or the reversal loop below would touch rows this
  -- transaction never locked.
  PERFORM fg.id
  FROM allocations a
  JOIN finished_goods fg ON fg.id = a.source_id
  WHERE a.source_type = 'finished_good'
    AND a.destination_type = 'taproom_sale'
    AND a.status = 'completed'
    AND (
      COALESCE(a.notes, '') = 'Square order ' || p_order_id
      OR EXISTS (
        SELECT 1 FROM square_draft_sales ds
        WHERE ds.square_order_id = p_order_id
          AND a.idempotency_key = 'square_draft_sale:' || ds.id::TEXT
      )
    )
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
      AND (
        COALESCE(a.notes, '') = 'Square order ' || p_order_id
        OR EXISTS (
          SELECT 1 FROM square_draft_sales ds
          WHERE ds.square_order_id = p_order_id
            AND a.idempotency_key = 'square_draft_sale:' || ds.id::TEXT
        )
      )
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
    --
    -- items_failed = 0 keeps every failure record out of the ledger (#547): a
    -- sealed order-total-mismatch log (v2, since 00262), a pre-atomic v1
    -- (00257) unsizeable log, and a deferred sale_missing record (#607) all
    -- applied no reversal, so their refund_amount must not count as prior money
    -- and their divergent order_total must not poison this refund's mismatch
    -- check. This subsumes the 00267 NOT-manual_reconcile filter (all
    -- manual_reconcile logs have items_failed >= 1) and also catches v1/pre-00267
    -- failure rows that were never flagged. The redundant NOT-manual_reconcile
    -- predicate is kept as belt-and-braces.
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
      AND items_failed = 0
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

      -- #606: two writers create the sale-side allocation for one Square order.
      -- The webhook's packaged path tags it in `notes`; the draft reconciler
      -- keys it as `square_draft_sale:<draft id>`. The LEFT JOIN resolves the
      -- second one structurally through square_draft_sales.square_order_id, and
      -- a non-null draft_sale_id is what marks a row draft-origin below.
      FOR v_alloc IN
        SELECT a.id, a.source_id, a.quantity, a.volume_bbl, ds.id AS draft_sale_id
        FROM allocations a
        LEFT JOIN square_draft_sales ds
          ON ds.square_order_id = p_order_id
         AND a.idempotency_key = 'square_draft_sale:' || ds.id::TEXT
        WHERE a.source_type = 'finished_good'
          AND a.destination_type = 'taproom_sale'
          AND a.status = 'completed'
          AND (
            COALESCE(a.notes, '') = 'Square order ' || p_order_id
            OR ds.id IS NOT NULL
          )
        ORDER BY a.id
      LOOP
        IF v_alloc.source_id IS NULL THEN
          RAISE EXCEPTION 'Original Square allocation % has no finished-good source',
            v_alloc.id;
        END IF;

        -- Packaged lines are discrete selling units, so a partial refund floors
        -- (never over-reverse a whole can). A reconciled pour is a continuous
        -- keg draw, so it rounds at the column's scale — flooring it to zero is
        -- exactly the #606 defect.
        v_target_reversed_qty := CASE
          WHEN v_is_full THEN v_alloc.quantity
          WHEN v_alloc.draft_sale_id IS NOT NULL
            THEN round(v_alloc.quantity * v_cumulative_proportion, 4)
          ELSE floor(v_alloc.quantity * v_cumulative_proportion)
        END;

        -- Decimal-tolerant (#606): reversedQuantity is fractional for draft
        -- rows, and an integer-only pattern silently dropped them from the
        -- cumulative catch-up, which would double-reverse on the next event.
        SELECT COALESCE(SUM((reversal.value->>'reversedQuantity')::NUMERIC), 0)
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
          AND reversal.value->>'reversedQuantity' ~ '^[0-9]+(\.[0-9]+)?$';

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

        -- #606: a draft-origin row never debited a bin at sale time (00257
        -- stages the pour and CONTINUEs before the bin block), so crediting one
        -- here would invent physical stock. No bin, and no unmapped-bin warning
        -- either — there is nothing to map.
        IF v_alloc.draft_sale_id IS NOT NULL THEN
          v_reversed_draft_ids := v_reversed_draft_ids || v_alloc.draft_sale_id;
        ELSIF v_bin_id IS NOT NULL THEN
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
          'draftSaleId', v_alloc.draft_sale_id,
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
          -- #606: an un-reconciled row is retired outright (nothing was ever
          -- posted for it), but a RECONCILED row is only voided when this
          -- refund actually reversed its allocation. Otherwise voided_at would
          -- claim a neutralization that never happened.
          UPDATE square_draft_sales
          SET voided_at = now()
          WHERE square_order_id = p_order_id
            AND voided_at IS NULL
            AND (reconciled_at IS NULL OR id = ANY(v_reversed_draft_ids));
          GET DIAGNOSTICS v_draft_voided = ROW_COUNT;
          IF v_draft_voided < v_draft_count THEN
            v_warnings := v_warnings || jsonb_build_array(format(
              '%s reconciled draft row(s) left un-voided: no reconciliation allocation was reversed for them, so their TTB removal is still outstanding',
              v_draft_count - v_draft_voided
            ));
          END IF;
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
  'Atomically claims and ingests one Square refund: serializes by order, selects the sale allocations for that order by the packaged note OR the reconciler''s square_draft_sale:<id> idempotency key (#606), calculates each allocation''s cumulative refund target in NUMERIC (fractional keg draws included), applies only the unreversed delta, credits physical bins for packaged rows only (a draft pour never debited one), voids cumulatively full-refund draft rows whose effects were actually neutralized, and finalizes square_sync_log. A refund whose sale has not been ingested yet is recorded durably as state=sale_missing and returns kind=sale_missing with retry_after_seconds so the caller can have Square redeliver; a later delivery re-opens that record and applies the reversal (#607). Unexpected failures roll back every effect; refund-id retries deduplicate; stale pre-atomic claims remain manual-reconciliation records. Refund failure records (items_failed > 0) are excluded from the cumulative monetary ledger (#547). SECURITY INVOKER and service_role-only.';

REVOKE ALL ON FUNCTION ingest_square_refund_atomic(
  TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, BIGINT, BIGINT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ingest_square_refund_atomic(
  TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, BIGINT, BIGINT
) TO service_role;

-- The badge on Settings -> Integrations counts the same queue the reconciler
-- drains, and the reconciler has excluded refund-voided rows since 00241. This
-- partial index (added by 00243 with a comment asserting the badge matched it)
-- still indexed voided rows, so it no longer describes either reader (#608).
DROP INDEX IF EXISTS idx_square_draft_sales_unreconciled;
CREATE INDEX IF NOT EXISTS idx_square_draft_sales_unreconciled
  ON square_draft_sales (sold_at)
  WHERE reconciled_at IS NULL AND voided_at IS NULL;
COMMENT ON INDEX idx_square_draft_sales_unreconciled IS
  'Pending keg-pour queue: rows POST /api/square/reconcile-draft-sales will process, which is exactly what GET /api/square/sync/status counts for the settings badge (#608). Refund-voided rows are terminal and excluded from both.';

NOTIFY pgrst, 'reload schema';
