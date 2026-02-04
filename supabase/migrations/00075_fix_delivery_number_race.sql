-- Fix race condition in delivery number generation.
-- Without a lock, concurrent inserts for the same date can generate duplicate numbers.
-- Advisory lock serializes per-date while allowing different dates in parallel.

CREATE OR REPLACE FUNCTION generate_delivery_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_date TEXT;
  v_seq INTEGER;
BEGIN
  v_date := TO_CHAR(COALESCE(NEW.scheduled_date, CURRENT_DATE), 'YYYYMMDD');

  -- Lock per-date to prevent concurrent duplicate numbers
  PERFORM pg_advisory_xact_lock(hashtext('delivery_number_' || v_date));

  SELECT COALESCE(MAX(
    CAST(SUBSTRING(delivery_number FROM 'DEL-' || v_date || '-(\d+)') AS INTEGER)
  ), 0) + 1
  INTO v_seq
  FROM deliveries
  WHERE delivery_number LIKE 'DEL-' || v_date || '-%';

  NEW.delivery_number := 'DEL-' || v_date || '-' || LPAD(v_seq::TEXT, 3, '0');
  RETURN NEW;
END;
$$;
