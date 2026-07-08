-- 00213_extend_entity_revisions_ledger.sql
-- Audit backlog #15 (broad-ledger extension): put the four remaining
-- stock/price ledgers under the same append-only revision trail that 00211
-- gave `allocations`.
--
-- The audit's cross-cutting "ledger unaudited and non-append-only" gap covered
-- more than allocations: inventory_lots, packaging_sessions, pricing_tier_prices
-- and keg_transactions were all editable/deletable with zero revision history,
-- so a silent hand-edit (or delete) left no "who / what / when". This adds the
-- shared log_entity_revision() trigger (00019) to each — every INSERT/UPDATE/
-- DELETE now writes an entity_revisions row (entity_type = table name,
-- changed_by = auth.uid(), full old_data/new_data jsonb).
--
-- Why triggers, not new created_by columns: log_entity_revision() already
-- records the actor (changed_by = auth.uid()) and the full row image per
-- change, so the audit trail is complete without altering these base tables.
-- inventory_lots/keg_transactions/pricing_tier_prices have no created_by column
-- and don't need one for the "who did what when" requirement.
--
-- log_entity_revision() is SECURITY DEFINER and inserts into entity_revisions
-- regardless of caller RLS, so these triggers never block a legitimate write.
-- entity_revisions.entity_type is free text (only `operation` is constrained),
-- so the new table names need no allow-list change. All four tables have a UUID
-- `id` column, which the function requires (COALESCE(NEW.id, OLD.id)).
--
-- Live-safe: purely additive AFTER triggers; no data change, no lock beyond the
-- brief ACCESS EXCLUSIVE for CREATE TRIGGER.

DROP TRIGGER IF EXISTS tr_inventory_lots_revision ON inventory_lots;
CREATE TRIGGER tr_inventory_lots_revision
  AFTER INSERT OR UPDATE OR DELETE ON inventory_lots
  FOR EACH ROW EXECUTE FUNCTION log_entity_revision();

DROP TRIGGER IF EXISTS tr_packaging_sessions_revision ON packaging_sessions;
CREATE TRIGGER tr_packaging_sessions_revision
  AFTER INSERT OR UPDATE OR DELETE ON packaging_sessions
  FOR EACH ROW EXECUTE FUNCTION log_entity_revision();

DROP TRIGGER IF EXISTS tr_pricing_tier_prices_revision ON pricing_tier_prices;
CREATE TRIGGER tr_pricing_tier_prices_revision
  AFTER INSERT OR UPDATE OR DELETE ON pricing_tier_prices
  FOR EACH ROW EXECUTE FUNCTION log_entity_revision();

DROP TRIGGER IF EXISTS tr_keg_transactions_revision ON keg_transactions;
CREATE TRIGGER tr_keg_transactions_revision
  AFTER INSERT OR UPDATE OR DELETE ON keg_transactions
  FOR EACH ROW EXECUTE FUNCTION log_entity_revision();
