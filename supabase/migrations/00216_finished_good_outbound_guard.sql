-- 00216_finished_good_outbound_guard.sql
-- Audit fix M14 (backlog #18): server-side guard on finished_goods quantity.
--
-- Finished-goods stock is ledger-style: quantity means "how many were packaged"
-- and is never edited down by day-to-day flows — every removal is an allocation,
-- and available stock is quantity minus open+completed allocations
-- (docs/knowledge/entity-model.md). The revise_packaging_session RPC (00184)
-- already refuses to reduce a lot below what is committed out of it, but the
-- generic entity-update path (src/services/entity-service.ts standard UPDATE) does
-- not — so a direct finished_goods edit could set quantity below the allocated
-- total, stranding those allocations and driving available_quantity negative.
--
-- Add a BEFORE UPDATE trigger that mirrors the revise-RPC guard: block any
-- quantity reduction that would fall below the sum of active (planned/completed)
-- allocations sourced from this finished good. This is the finished_goods-side
-- twin of the allocations-side availability guard (00212).
--
-- Policy (block-hard, decided — same call as #12/00212): reductions below the
-- committed total are rejected outright. There is no "reason_code" exemption here
-- because a finished_goods row has no adjustment channel of its own — intentional
-- stock-down corrections belong in an allocation (destination_type='adjustment',
-- which 00212 exempts), not in a direct quantity edit. Increases and no-ops are
-- always allowed.
--
-- Race safety: the UPDATE already holds the finished_goods row lock, and 00212's
-- allocator locks the same row (SELECT ... FOR UPDATE) before inserting an
-- allocation, so the two guards serialize on that row — no extra locking needed.
--
-- Live-safe: BEFORE-UPDATE only (packaging completion INSERTs finished_goods, so
-- it is unaffected); the revise RPC's own identical guard still fires first, this
-- just re-checks. Verified against live in a self-rolling-back DO block
-- (blocked a below-outbound reduction, allowed an increase) before push.

CREATE OR REPLACE FUNCTION public.guard_finished_good_outbound()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_outbound NUMERIC;
BEGIN
  -- Only a quantity reduction can strand already-committed allocations.
  IF NEW.quantity >= OLD.quantity THEN
    RETURN NEW;
  END IF;

  -- Everything still reserved out of this finished good.
  SELECT COALESCE(SUM(quantity), 0)
  INTO v_outbound
  FROM allocations
  WHERE source_type = 'finished_good'
    AND source_id = NEW.id
    AND status IN ('planned', 'completed');

  IF NEW.quantity < v_outbound THEN
    RAISE EXCEPTION 'Cannot reduce finished goods (lot %) to % — % units are already allocated to orders or other destinations',
      NEW.lot_number, NEW.quantity, v_outbound
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.guard_finished_good_outbound() IS
  'BEFORE UPDATE guard on finished_goods (M14): rejects a quantity reduction that would fall below the sum of active (planned/completed) allocations sourced from this finished good. Twin of the allocations availability guard (00212); intentional stock-down corrections go through an adjustment allocation, not a direct quantity edit.';

DROP TRIGGER IF EXISTS trg_guard_finished_good_outbound ON finished_goods;
CREATE TRIGGER trg_guard_finished_good_outbound
  BEFORE UPDATE ON finished_goods
  FOR EACH ROW EXECUTE FUNCTION guard_finished_good_outbound();
