-- 00271_fulfill_past_orders.sql
--
-- One-time DATA migration: mark orders that already happened as fulfilled.
--
-- Buckets:
--   A. The ~200 historical Beer orders.xlsx keg orders cancelled per issue
--      #425. Product decision 2026-07-19 (DECISIONS.md) reverses that: they
--      are real, delivered sales and must read `fulfilled` so fulfilled-only
--      analytics (Product Mix, Top Customers) and revenue views include them.
--   B. Any past-dated order still in scheduled / picking / packed — the goods
--      physically moved; only the status is stale.
--
-- Past-dated draft/confirmed orders are intentionally NOT touched (a draft
-- that never got confirmed likely isn't a completed sale).
--
-- Status-only by design: triggers are disabled for this transaction because
--   * validate_state_transition (00205) forbids cancelled -> fulfilled and
--     scheduled -> fulfilled; this is a sanctioned historical correction.
--   * on_order_fulfillment_keg_transactions (00183) would fabricate keg ship
--     transactions for fills MGR never recorded (why #425 originally chose
--     cancelled). Keg inventory must stay untouched.
--   * order status notifications (00022) would broadcast hundreds of stale
--     "Order Fulfilled" notifications to every user.
-- Side effect: updated_at is not bumped, so the daily fulfilled_count trend
-- (which approximates fulfillment date via updated_at) attributes these to
-- their last real update, not today.
--
-- On a fresh database (CI chain replay, local reset) there are no orders yet,
-- so this no-ops; the preimage table is still created so live and replayed
-- catalogs stay identical for the drift gate.
--
-- Rollback: UPDATE orders o SET status = b.prior_status
--           FROM _backup_fulfill_past_orders b WHERE o.id = b.id;

SET LOCAL session_replication_role = replica;

-- Permanent preimage of every row this migration changes (empty on fresh DBs).
CREATE TABLE IF NOT EXISTS _backup_fulfill_past_orders (
  id uuid PRIMARY KEY,
  order_number text NOT NULL,
  prior_status text NOT NULL,
  order_date date,
  prior_updated_at timestamptz,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE _backup_fulfill_past_orders ENABLE ROW LEVEL SECURITY;
-- No policies: service-role/psql access only.

INSERT INTO _schema_registry (table_name, description, domain, relationships)
VALUES (
  '_backup_fulfill_past_orders',
  'Preimage of order statuses changed by data migration 00271 (historical orders bulk-set to fulfilled; reverses issue #425). Rollback source; not application data.',
  'system',
  '["references: orders"]'::jsonb
)
ON CONFLICT (table_name) DO NOTHING;

DO $$
DECLARE
  v_count integer;
BEGIN
  CREATE TEMP TABLE _candidates ON COMMIT DROP AS
  SELECT id, order_number, status, order_date, updated_at
  FROM orders
  WHERE
    -- Bucket A: historical XLSX orders cancelled per #425 (same belt-and-
    -- suspenders predicate as cancel_historical_beer_orders.py)
    (status = 'cancelled'
       AND order_number ~ '^XLSX-\d{8}-'
       AND notes LIKE 'Beer orders.xlsx source of truth%'
       AND order_date < CURRENT_DATE)
    OR
    -- Bucket B: past-dated orders still mid-pipeline
    (status IN ('scheduled', 'picking', 'packed')
       AND order_date < CURRENT_DATE);

  SELECT count(*) INTO v_count FROM _candidates;
  IF v_count = 0 THEN
    RAISE NOTICE '00271: no candidate orders (fresh DB or already applied) — nothing to do.';
    RETURN;
  END IF;

  INSERT INTO _backup_fulfill_past_orders (id, order_number, prior_status, order_date, prior_updated_at)
  SELECT id, order_number, status, order_date, updated_at FROM _candidates
  ON CONFLICT (id) DO NOTHING;

  UPDATE orders o
  SET status = 'fulfilled'
  FROM _candidates c
  WHERE o.id = c.id;

  RAISE NOTICE '00271: % orders set to fulfilled (preimage in _backup_fulfill_past_orders).', v_count;
END $$;
