-- 00211_allocation_ledger_hardening.sql
-- Audit fixes M11/M13 (backlog #15): allocation ledger audit-trail hardening.
-- Scope (decided): allocations-focused.
--
-- M11 — allocation rows were hard-deletable and fully editable with zero
--   revision history: deleting a completed depletion silently restored stock
--   untraced. Fixes:
--     (1) entity_revisions trigger on allocations (full INSERT/UPDATE/DELETE
--         audit trail via the shared log_entity_revision(), 00019);
--     (2) block hard-deletes of *completed* allocations — a completed depletion
--         must be reversed with a cancellation/adjustment, never silently removed;
--     (3) default created_by = auth.uid() so the actor is recorded even when a
--         caller forgets to set it.
--
-- M13 — count/loss corrections weren't required to carry a reason. The count-
--   adjustment flow already writes destination_type='adjustment' with
--   reason_code='count_adjustment' (src/domain/inventory-count.ts); enforce it:
--     (4) CHECK that any 'adjustment' allocation carries a reason_code.
--
-- Live-safe: existing allocations are batch/inventory_lot/external -> batch/loss
-- (no 'adjustment' rows), so the CHECK validates clean; the delete-block and
-- revision trigger only affect future operations.

-- (1) Audit trail: reuse the shared revision logger (00019).
DROP TRIGGER IF EXISTS tr_allocations_revision ON allocations;
CREATE TRIGGER tr_allocations_revision
  AFTER INSERT OR UPDATE OR DELETE ON allocations
  FOR EACH ROW EXECUTE FUNCTION log_entity_revision();

-- (3) Record the actor by default.
ALTER TABLE allocations ALTER COLUMN created_by SET DEFAULT auth.uid();

-- (2) Block hard-deletes of completed allocations.
CREATE OR REPLACE FUNCTION prevent_completed_allocation_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.status = 'completed' THEN
    RAISE EXCEPTION 'Completed allocations cannot be deleted — reverse them with a cancellation or a count adjustment so stock changes stay traced.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$function$;

COMMENT ON FUNCTION prevent_completed_allocation_delete() IS
  'BEFORE DELETE guard on allocations (M11): a completed depletion cannot be hard-deleted; it must be reversed via cancellation/adjustment so stock stays traced.';

DROP TRIGGER IF EXISTS trg_prevent_completed_allocation_delete ON allocations;
CREATE TRIGGER trg_prevent_completed_allocation_delete
  BEFORE DELETE ON allocations
  FOR EACH ROW EXECUTE FUNCTION prevent_completed_allocation_delete();

-- (4) Require a reason on adjustment allocations.
ALTER TABLE allocations
  ADD CONSTRAINT chk_allocation_adjustment_reason
  CHECK (destination_type <> 'adjustment' OR reason_code IS NOT NULL);

COMMENT ON CONSTRAINT chk_allocation_adjustment_reason ON allocations IS
  'M13: an adjustment allocation (destination_type = adjustment) must carry a reason_code (e.g. count_adjustment).';
