-- Automatically populate orders.fulfilled_date when an order transitions to
-- fulfilled status (audit finding 32: nothing in the app or DB wrote
-- fulfilled_date, so the QuickBooks invoice sync silently fell back to
-- order_date for the invoice transaction date).
--
-- Modeled on 00106_pick_list_timestamps_trigger.sql. A BEFORE UPDATE trigger
-- (rather than a client-side transition side effect) because:
-- - it is atomic with the status UPDATE, so the QBO invoice auto-sync — which
--   fires immediately after the transition and reads fulfilled_date
--   server-side for TxnDate (src/integrations/quickbooks/sync-invoice.ts) —
--   can never race a separate follow-up write
-- - it covers every UI transition path plus direct API writes
--
-- The IS NULL guard preserves an explicitly provided fulfilled_date (e.g.
-- backfills) instead of clobbering it with today's date.
--
-- No new RPC/view: no hand-added entries in src/types/supabase.ts needed.

CREATE OR REPLACE FUNCTION set_order_fulfilled_date()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'fulfilled' AND NEW.fulfilled_date IS NULL THEN
    NEW.fulfilled_date = CURRENT_DATE;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_order_fulfilled_date
  BEFORE UPDATE ON orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION set_order_fulfilled_date();
