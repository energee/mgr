-- Atomic purchase-order receiving.
--
-- Replaces a multi-step client write path (insert receives -> read status -> decide ->
-- validate transition -> update status) that had no transaction: the po_receives rows were
-- inserted BEFORE the status was read and validated, so an illegal transition or a failed
-- status update threw AFTER the receipts were already persisted, with nothing to roll them
-- back. Receiving against a `draft` PO recorded the receipt and left the status untouched.
--
-- Everything now happens in one function, so it commits or aborts as a unit. This function
-- is the SINGLE SOURCE OF TRUTH for the fulfilled/partial rule; the TypeScript module that
-- previously owned it (src/domain/purchasing/po-receipt-status.ts) is deleted in the same
-- change. Deciding the status in the client was not merely untidy — it was decided from
-- reads taken outside the transaction, so a concurrent receipt could make it commit a status
-- computed from stale numbers.
--
-- SECURITY INVOKER: the function runs as the calling user, so the existing RLS policies on
-- purchase_orders / po_line_items / po_receives apply unchanged. It deliberately does NOT use
-- SECURITY DEFINER — there is no reason for a receipt to bypass the caller's RLS.

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

  -- Submitted entries, zero/negative quantities dropped (they are no-ops, not errors).
  CREATE TEMP TABLE _submitted ON COMMIT DROP AS
  SELECT
    (e ->> 'po_line_item_id')::UUID           AS po_line_item_id,
    (e ->> 'quantity')::DECIMAL(10, 4)        AS quantity,
    NULLIF(e ->> 'lot_number', '')            AS lot_number,
    NULLIF(e ->> 'expiration_date', '')::DATE AS expiration_date,
    NULLIF(e ->> 'notes', '')                 AS notes
  FROM jsonb_array_elements(p_entries) AS e
  WHERE (e ->> 'quantity')::DECIMAL(10, 4) > 0;

  IF NOT EXISTS (SELECT 1 FROM _submitted) THEN
    RAISE EXCEPTION 'No quantities to receive'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Reject an over-receipt BEFORE writing anything. Previously the only guard was a clamp on
  -- the UI input, so any other caller could record 999 against 10 ordered and silently close
  -- the order. An entry naming a line item that is not on this order is rejected too.
  --
  -- Quantities are DECIMAL, so these sums are exact — no float epsilon is needed here. (The
  -- old client-side rule compared IEEE-754 doubles and could strand a line ordered 0.8 and
  -- received 0.7 + 0.1 at `partial` forever.)
  SELECT
    s.po_line_item_id                AS po_line_item_id,
    COALESCE(li.quantity, 0)         AS ordered,
    COALESCE(prior.received, 0)      AS already_received,
    SUM(s.quantity)                  AS submitted
  INTO v_offender
  FROM _submitted s
  LEFT JOIN po_line_items li
    ON li.id = s.po_line_item_id AND li.po_id = p_po_id
  LEFT JOIN LATERAL (
    SELECT SUM(r.quantity) AS received
    FROM po_receives r
    WHERE r.po_line_item_id = s.po_line_item_id
  ) prior ON TRUE
  GROUP BY s.po_line_item_id, li.quantity, prior.received
  HAVING COALESCE(prior.received, 0) + SUM(s.quantity) > COALESCE(li.quantity, 0)
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Cannot receive more than was ordered. Line %: ordered %, already received %, submitted %',
      v_offender.po_line_item_id, v_offender.ordered,
      v_offender.already_received, v_offender.submitted
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO po_receives (po_line_item_id, quantity, lot_number, expiration_date, notes)
  SELECT po_line_item_id, quantity, lot_number, expiration_date, notes
  FROM _submitted;

  -- Decide the resulting status from the rows that now exist, inside this transaction.
  --
  -- `fulfilled` is financially meaningful and hard to undo, so the rule refuses to reach it on
  -- absent or nonsensical data and degrades to `partial`, which a human can still resolve:
  --   * an order with NO line items is never fulfilled (there is nothing to have received);
  --   * a line whose ordered quantity is null or <= 0 is bad data and never counts as received.
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
        AND (li.quantity IS NULL OR li.quantity <= 0 OR t.received < li.quantity)
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
  'Rejects over-receipts and illegal transitions before any row is written. '
  'Single source of truth for the fulfilled/partial rule.';
