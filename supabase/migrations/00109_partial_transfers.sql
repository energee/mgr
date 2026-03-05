-- Migration: Partial Transfers
-- Supports partial shipments for location transfers. When a transfer ships
-- partially, per-line shipped quantities are tracked and a remainder transfer
-- is auto-created for unshipped quantities.

-- =============================================================================
-- 1. Add quantity_shipped to transfer_lines
-- =============================================================================

ALTER TABLE transfer_lines ADD COLUMN quantity_shipped INTEGER;

COMMENT ON COLUMN transfer_lines.quantity_shipped
  IS 'Actual quantity shipped. NULL means not yet shipped. Less than quantity means partial shipment.';

-- =============================================================================
-- 2. Add remainder_of column to location_transfers
-- =============================================================================

ALTER TABLE location_transfers
ADD COLUMN remainder_of UUID REFERENCES location_transfers(id) ON DELETE SET NULL;

CREATE INDEX idx_location_transfers_remainder ON location_transfers(remainder_of)
  WHERE remainder_of IS NOT NULL;

COMMENT ON COLUMN location_transfers.remainder_of
  IS 'If this transfer was auto-created as a remainder from a partial shipment, references the original transfer.';

-- =============================================================================
-- 3. Create ship_transfer_partial function
-- =============================================================================

CREATE OR REPLACE FUNCTION ship_transfer_partial(
  p_transfer_id UUID,
  p_line_quantities JSONB  -- Array of {line_id: UUID, quantity_shipped: INTEGER}
)
RETURNS UUID  -- Returns remainder transfer ID (NULL if fully shipped)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_transfer RECORD;
  v_line RECORD;
  v_qty_entry JSONB;
  v_shipped INT;
  v_has_remainder BOOLEAN := FALSE;
  v_remainder_id UUID;
  v_new_line_id UUID;
  v_user_id UUID;
BEGIN
  -- Get current user
  v_user_id := auth.uid();

  -- Validate transfer exists and is in planned status
  SELECT * INTO v_transfer
  FROM location_transfers
  WHERE id = p_transfer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer not found: %', p_transfer_id;
  END IF;

  IF v_transfer.status != 'planned' THEN
    RAISE EXCEPTION 'Transfer must be in planned status to ship (current: %)', v_transfer.status;
  END IF;

  -- Update each line's quantity_shipped from the JSONB input
  FOR v_qty_entry IN SELECT * FROM jsonb_array_elements(p_line_quantities)
  LOOP
    v_shipped := (v_qty_entry ->> 'quantity_shipped')::INT;

    -- Validate shipped quantity
    SELECT * INTO v_line
    FROM transfer_lines
    WHERE id = (v_qty_entry ->> 'line_id')::UUID
      AND transfer_id = p_transfer_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Transfer line % not found for transfer %',
        v_qty_entry ->> 'line_id', p_transfer_id;
    END IF;

    IF v_shipped < 0 THEN
      RAISE EXCEPTION 'Shipped quantity cannot be negative for line %', v_line.id;
    END IF;

    IF v_shipped > v_line.quantity THEN
      RAISE EXCEPTION 'Shipped quantity (%) exceeds requested quantity (%) for line %',
        v_shipped, v_line.quantity, v_line.id;
    END IF;

    UPDATE transfer_lines
    SET quantity_shipped = v_shipped
    WHERE id = v_line.id;

    -- Check if this line has unshipped remainder
    IF v_shipped < v_line.quantity THEN
      v_has_remainder := TRUE;
    END IF;
  END LOOP;

  -- Also check for lines not included in the input (treat as 0 shipped)
  FOR v_line IN
    SELECT tl.*
    FROM transfer_lines tl
    WHERE tl.transfer_id = p_transfer_id
      AND tl.id NOT IN (
        SELECT (elem ->> 'line_id')::UUID
        FROM jsonb_array_elements(p_line_quantities) AS elem
      )
  LOOP
    -- Lines not mentioned are not shipped (quantity_shipped stays NULL = 0)
    UPDATE transfer_lines
    SET quantity_shipped = 0
    WHERE id = v_line.id;

    v_has_remainder := TRUE;
  END LOOP;

  IF v_has_remainder THEN
    -- Create remainder transfer
    INSERT INTO location_transfers (
      from_bin_id, to_bin_id, status, delivery_id, notes, remainder_of
    )
    VALUES (
      v_transfer.from_bin_id,
      v_transfer.to_bin_id,
      'planned',
      NULL,  -- Remainder is not assigned to original delivery
      'Auto-created remainder from partial shipment of transfer ' || p_transfer_id,
      p_transfer_id
    )
    RETURNING id INTO v_remainder_id;

    -- Create remainder lines for unshipped quantities
    FOR v_line IN
      SELECT *
      FROM transfer_lines
      WHERE transfer_id = p_transfer_id
        AND (quantity_shipped IS NULL OR quantity_shipped < quantity)
    LOOP
      INSERT INTO transfer_lines (transfer_id, finished_good_id, inventory_lot_id, quantity)
      VALUES (
        v_remainder_id,
        v_line.finished_good_id,
        v_line.inventory_lot_id,
        v_line.quantity - COALESCE(v_line.quantity_shipped, 0)
      );
    END LOOP;

    -- Set original transfer to partial status
    UPDATE location_transfers
    SET status = 'partial',
        ship_date = CURRENT_DATE,
        shipped_by = v_user_id,
        updated_at = NOW()
    WHERE id = p_transfer_id;
  ELSE
    -- Fully shipped — set to in_transit
    UPDATE location_transfers
    SET status = 'in_transit',
        ship_date = CURRENT_DATE,
        shipped_by = v_user_id,
        updated_at = NOW()
    WHERE id = p_transfer_id;
  END IF;

  RETURN v_remainder_id;
END;
$$;

COMMENT ON FUNCTION ship_transfer_partial(UUID, JSONB)
  IS 'Ships a transfer with per-line quantities. Creates a remainder transfer for unshipped items. Returns remainder transfer ID or NULL if fully shipped.';

-- =============================================================================
-- 4. Recreate view with remainder info
-- =============================================================================

DROP VIEW IF EXISTS location_transfers_with_details;

CREATE VIEW location_transfers_with_details
WITH (security_invoker = true)
AS
SELECT
  lt.*,
  fb.name AS from_bin_name,
  fl.name AS from_location_name,
  tb.name AS to_bin_name,
  tl.name AS to_location_name,
  d.delivery_number,
  (SELECT COUNT(*) FROM transfer_lines tl2 WHERE tl2.transfer_id = lt.id) AS lines_count
FROM location_transfers lt
JOIN bins fb ON fb.id = lt.from_bin_id
JOIN locations fl ON fl.id = fb.location_id
JOIN bins tb ON tb.id = lt.to_bin_id
JOIN locations tl ON tl.id = tb.location_id
LEFT JOIN deliveries d ON d.id = lt.delivery_id;

COMMENT ON VIEW location_transfers_with_details
  IS 'Location transfers with bin/location names and line counts.';

-- =============================================================================
-- 5. Update schema registry
-- =============================================================================

UPDATE _schema_registry
SET description = 'Transfers of finished goods between bins/locations. Supports partial shipments with auto-created remainder transfers.',
    key_fields = '["status", "from_bin_id", "to_bin_id", "delivery_id", "remainder_of"]',
    updated_at = NOW()
WHERE table_name = 'location_transfers';

UPDATE _schema_registry
SET description = 'Line items for location transfers. Tracks both requested quantity and actual shipped quantity for partial shipment support.',
    key_fields = '["transfer_id", "finished_good_id", "inventory_lot_id", "quantity", "quantity_shipped"]',
    updated_at = NOW()
WHERE table_name = 'transfer_lines';
