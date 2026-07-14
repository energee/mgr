-- Cleanup of receive_purchase_order_items (00248). Behavior-preserving, except that one
-- misleading error message is corrected.
--
-- 1. The submitted entries were materialized into `CREATE TEMP TABLE _submitted ON COMMIT
--    DROP`. That works only because PostgREST gives each RPC call its own transaction: called
--    twice within one transaction (e.g. from another PL/pgSQL function looping over orders)
--    the second CREATE fails with "relation _submitted already exists", because ON COMMIT DROP
--    does not drop until commit. A CTE does the same job with no such trap and no per-call
--    catalog churn.
--
-- 2. `li.quantity IS NULL` was dead code: po_line_items.quantity is NOT NULL (00010).
--
-- 3. An entry naming a line item that is NOT on this order was rejected — correctly — but
--    reported as "Cannot receive more than was ordered ... ordered 0", which describes the
--    mechanism (the LEFT JOIN yields no ordered quantity) rather than the caller's mistake. It
--    now has its own check and message. Both cases still abort before any row is written.
--
-- The status rule, the FOR UPDATE serialization, the transition validation, SECURITY INVOKER,
-- and the return value are all unchanged. See 00248 for why the rule lives in SQL at all.
--
-- The transition table below is deliberately still a hardcoded CASE rather than a read of
-- enum_values.metadata->'next_states'. Those rows are mutable metadata with a documented drift
-- history (00192: 'brewing' was dropped from enum_values in 00039 with no row backfill), and
-- nothing else in SQL consumes them. Sourcing the rule from them would trade a duplication you
-- can see for a receiving path that silently rejects every transition if a row goes missing.

CREATE OR REPLACE FUNCTION receive_purchase_order_items(
  p_po_id UUID,
  p_entries JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_current_status TEXT;
  v_target_status  TEXT;
  v_valid_next     TEXT[];
  v_offender       RECORD;
  v_foreign_line   UUID;
BEGIN
  -- Lock the order for the duration of the transaction. Two concurrent receipts against the
  -- same PO serialize here, so the over-receipt check below cannot be raced.
  SELECT status INTO v_current_status
  FROM purchase_orders
  WHERE id = p_po_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order % not found', p_po_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Zero/negative quantities are dropped throughout as no-ops, not errors: the UI submits a
  -- row per line whether or not the user typed into it.
  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_entries) AS e
    WHERE (e ->> 'quantity')::DECIMAL(10, 4) > 0
  ) THEN
    RAISE EXCEPTION 'No quantities to receive'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- An entry naming a line item that is not on this order is a caller error, not an
  -- over-receipt. Checked first, so it reports what actually went wrong.
  SELECT (e ->> 'po_line_item_id')::UUID
  INTO v_foreign_line
  FROM jsonb_array_elements(p_entries) AS e
  WHERE (e ->> 'quantity')::DECIMAL(10, 4) > 0
    AND NOT EXISTS (
      SELECT 1 FROM po_line_items li
      WHERE li.id = (e ->> 'po_line_item_id')::UUID AND li.po_id = p_po_id
    )
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Line item % is not on purchase order %', v_foreign_line, p_po_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Reject an over-receipt BEFORE writing anything. Previously the only guard was a clamp on
  -- the UI input, which does not exist for any other caller, so without this a caller could
  -- record 999 against 10 ordered and silently close the order.
  --
  -- Quantities are DECIMAL, so these sums are exact — no float epsilon is needed. (The old
  -- client-side rule compared IEEE-754 doubles and could strand a line ordered 0.8 and
  -- received 0.7 + 0.1 at `partial` forever.)
  --
  -- Entries are summed per line item: two entries against the same line must be weighed
  -- together against the ordered quantity, or each could pass while the pair over-receives.
  WITH submitted AS (
    SELECT
      (e ->> 'po_line_item_id')::UUID          AS po_line_item_id,
      SUM((e ->> 'quantity')::DECIMAL(10, 4))  AS quantity
    FROM jsonb_array_elements(p_entries) AS e
    WHERE (e ->> 'quantity')::DECIMAL(10, 4) > 0
    GROUP BY 1
  )
  SELECT
    s.po_line_item_id           AS po_line_item_id,
    li.quantity                 AS ordered,
    COALESCE(prior.received, 0) AS already_received,
    s.quantity                  AS submitted
  INTO v_offender
  FROM submitted s
  JOIN po_line_items li
    ON li.id = s.po_line_item_id AND li.po_id = p_po_id
  LEFT JOIN LATERAL (
    SELECT SUM(r.quantity) AS received
    FROM po_receives r
    WHERE r.po_line_item_id = s.po_line_item_id
  ) prior ON TRUE
  WHERE COALESCE(prior.received, 0) + s.quantity > li.quantity
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Cannot receive more than was ordered. Line %: ordered %, already received %, submitted %',
      v_offender.po_line_item_id, v_offender.ordered,
      v_offender.already_received, v_offender.submitted
      USING ERRCODE = 'check_violation';
  END IF;

  -- One row per submitted entry — NOT grouped. Two entries against the same line (two lots,
  -- say) are two receipts, and each keeps its own lot_number/expiration_date.
  INSERT INTO po_receives (po_line_item_id, quantity, lot_number, expiration_date, notes)
  SELECT
    (e ->> 'po_line_item_id')::UUID,
    (e ->> 'quantity')::DECIMAL(10, 4),
    NULLIF(e ->> 'lot_number', ''),
    NULLIF(e ->> 'expiration_date', '')::DATE,
    NULLIF(e ->> 'notes', '')
  FROM jsonb_array_elements(p_entries) AS e
  WHERE (e ->> 'quantity')::DECIMAL(10, 4) > 0;

  -- Decide the resulting status from the rows that now exist, inside this transaction.
  --
  -- `fulfilled` is financially meaningful and hard to undo, so the rule refuses to reach it on
  -- absent or nonsensical data and degrades to `partial`, which a human can still resolve:
  --   * an order with NO line items is never fulfilled (there is nothing to have received);
  --   * a line whose ordered quantity is <= 0 is bad data and never counts as received.
  -- Both of these previously flipped the order straight to `fulfilled`.
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM po_line_items WHERE po_id = p_po_id) THEN 'partial'
    WHEN EXISTS (
      SELECT 1
      FROM po_line_items li
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(r.quantity), 0) AS received
        FROM po_receives r
        WHERE r.po_line_item_id = li.id
      ) t ON TRUE
      WHERE li.po_id = p_po_id
        AND (li.quantity <= 0 OR t.received < li.quantity)
    ) THEN 'partial'
    ELSE 'fulfilled'
  END
  INTO v_target_status;

  -- Already there — nothing to write. (partial -> partial is not a legal transition, so this
  -- short-circuit must come before the transition check.)
  IF v_target_status = v_current_status THEN
    RETURN v_current_status;
  END IF;

  -- Mirrors purchaseOrderStateMachine.transitions in src/entities/purchase-order/core.ts.
  -- Keep the two in step: a status added there needs a branch here.
  v_valid_next := CASE v_current_status
    WHEN 'draft'     THEN ARRAY['submitted', 'cancelled']
    WHEN 'submitted' THEN ARRAY['confirmed', 'cancelled']
    WHEN 'confirmed' THEN ARRAY['partial', 'fulfilled', 'cancelled']
    WHEN 'partial'   THEN ARRAY['fulfilled', 'cancelled']
    WHEN 'fulfilled' THEN ARRAY['closed']
    ELSE ARRAY[]::TEXT[]   -- cancelled, closed: terminal
  END;

  IF NOT (v_target_status = ANY (v_valid_next)) THEN
    RAISE EXCEPTION 'Cannot transition from "%" to "%". Valid transitions: %',
      v_current_status, v_target_status,
      COALESCE(NULLIF(array_to_string(v_valid_next, ', '), ''), 'none')
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE purchase_orders SET status = v_target_status WHERE id = p_po_id;

  RETURN v_target_status;
END;
$$;

COMMENT ON FUNCTION receive_purchase_order_items(UUID, JSONB) IS
  'Atomically record receipts against a PO and set its status to partial/fulfilled. '
  'Rejects over-receipts, entries naming line items not on the order, and illegal '
  'transitions before any row is written. Single source of truth for the fulfilled/partial rule.';
