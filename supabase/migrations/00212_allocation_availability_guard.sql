-- 00212_allocation_availability_guard.sql
-- Audit fix H7 (backlog #12): server-side availability guard on allocations.
--
-- Only the client capped allocation quantity, so two concurrent users could
-- oversell the same lot / finished good and drive available_quantity negative
-- (quick depletion explicitly warned-but-allowed). Add a BEFORE INSERT/UPDATE
-- trigger that, for depleting allocations against a finite source, locks the
-- source row (SELECT ... FOR UPDATE — serializes concurrent allocators) and
-- rejects the write if it would exceed what remains.
--
-- Policy (decided): block oversell for real depletions; EXEMPT count corrections
-- (destination_type = 'adjustment'), which intentionally drive availability down
-- to match a physical count. Sources without a simple finite on-hand column
-- (batch, external) are not guarded here.
--
-- Availability matches inventory_lots_with_quantities: stock (inventory_lots.quantity
-- or finished_goods.quantity) minus the sum of planned/completed allocations from
-- that source (adjustments included, since they too reduce what remains).
--
-- Live-safe: existing allocations are unchanged (BEFORE trigger fires only on new
-- writes); today's flows (batch consumption sized to the lot) stay within stock.

CREATE OR REPLACE FUNCTION public.guard_allocation_availability()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_stock NUMERIC;
  v_allocated NUMERIC;
BEGIN
  -- Count corrections may intentionally push availability negative.
  IF NEW.destination_type = 'adjustment' THEN
    RETURN NEW;
  END IF;

  -- Only active allocations consume; cancelled/rejected/etc. do not.
  IF NEW.status NOT IN ('planned', 'completed') THEN
    RETURN NEW;
  END IF;

  -- On UPDATE, re-check only when consumption could increase (quantity up, or a
  -- previously-inactive row becoming active). Benign edits (notes, status ->
  -- cancelled, planned -> completed at the same quantity) skip the guard.
  IF TG_OP = 'UPDATE'
     AND NEW.quantity <= OLD.quantity
     AND OLD.status IN ('planned', 'completed') THEN
    RETURN NEW;
  END IF;

  -- Lock the finite source row and read its on-hand quantity.
  IF NEW.source_type = 'inventory_lot' THEN
    SELECT quantity INTO v_stock FROM inventory_lots WHERE id = NEW.source_id FOR UPDATE;
  ELSIF NEW.source_type = 'finished_good' THEN
    SELECT quantity INTO v_stock FROM finished_goods WHERE id = NEW.source_id FOR UPDATE;
  ELSE
    -- batch / external sources have no simple finite on-hand column here.
    RETURN NEW;
  END IF;

  IF v_stock IS NULL THEN
    -- Source row missing (an FK/constraint elsewhere will surface it).
    RETURN NEW;
  END IF;

  -- Sum other active allocations from this source (exclude this row on UPDATE).
  SELECT COALESCE(sum(quantity), 0)
  INTO v_allocated
  FROM allocations
  WHERE source_type = NEW.source_type
    AND source_id = NEW.source_id
    AND status IN ('planned', 'completed')
    AND id <> NEW.id;

  IF NEW.quantity > v_stock - v_allocated THEN
    RAISE EXCEPTION 'Allocation of % exceeds availability (% on hand, % already allocated) for this %.',
      NEW.quantity, v_stock, v_allocated, NEW.source_type
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.guard_allocation_availability() IS
  'BEFORE INSERT/UPDATE guard on allocations (H7): rejects a depleting allocation that would exceed the source''s remaining quantity, locking the source row to prevent concurrent oversell. Exempts destination_type = adjustment (count corrections); only guards inventory_lot / finished_good sources.';

DROP TRIGGER IF EXISTS trg_guard_allocation_availability ON allocations;
CREATE TRIGGER trg_guard_allocation_availability
  BEFORE INSERT OR UPDATE ON allocations
  FOR EACH ROW EXECUTE FUNCTION guard_allocation_availability();
