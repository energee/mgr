-- =============================================================================
-- Migration: Keg Owners (Fleet Provider Tracking)
-- =============================================================================
-- Adds keg_owners dimension for tracking kegs by fleet provider (Owned, Microstar, etc.)
-- Adds keg_owner_deposits for per-owner per-type deposit amounts
-- Adds keg_owner_id to keg_transactions and order_items
-- Recreates all dependent views with owner dimension

-- =============================================================================
-- 1. Create keg_owners table
-- =============================================================================

CREATE TABLE keg_owners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  position INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE keg_owners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view keg owners"
  ON keg_owners FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert keg owners"
  ON keg_owners FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update keg owners"
  ON keg_owners FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete keg owners"
  ON keg_owners FOR DELETE
  TO authenticated
  USING (true);

-- Trigger for updated_at
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON keg_owners
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Seed data
INSERT INTO keg_owners (name, code, position) VALUES
  ('Owned', 'owned', 1),
  ('Microstar', 'microstar', 2),
  ('KegFleet', 'kegfleet', 3);

-- =============================================================================
-- 2. Create keg_owner_deposits table (deposits vary by size × owner)
-- =============================================================================

CREATE TABLE keg_owner_deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keg_owner_id UUID NOT NULL REFERENCES keg_owners(id) ON DELETE CASCADE,
  keg_type_id UUID NOT NULL REFERENCES keg_types(id) ON DELETE CASCADE,
  deposit_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(keg_owner_id, keg_type_id)
);

-- RLS
ALTER TABLE keg_owner_deposits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view keg owner deposits"
  ON keg_owner_deposits FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert keg owner deposits"
  ON keg_owner_deposits FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update keg owner deposits"
  ON keg_owner_deposits FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete keg owner deposits"
  ON keg_owner_deposits FOR DELETE
  TO authenticated
  USING (true);

-- Trigger for updated_at
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON keg_owner_deposits
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- =============================================================================
-- 3. Add keg_owner_id to keg_transactions
-- =============================================================================

ALTER TABLE keg_transactions
  ADD COLUMN keg_owner_id UUID REFERENCES keg_owners(id) ON DELETE RESTRICT;

-- =============================================================================
-- 4. Add keg_owner_id to order_items
-- =============================================================================

ALTER TABLE order_items
  ADD COLUMN keg_owner_id UUID REFERENCES keg_owners(id) ON DELETE SET NULL;

-- =============================================================================
-- 5. Drop dependent views and the keg_inventory table
-- =============================================================================
-- Drop in reverse dependency order. CASCADE from keg_inventory table
-- will handle views that depend on it, but we explicitly drop all
-- views we're recreating for clarity.

-- Views that depend on customer_keg_balances / customer_keg_balance_summary
DROP VIEW IF EXISTS customers_with_order_summary CASCADE;
DROP VIEW IF EXISTS customer_keg_balance_summary CASCADE;
DROP VIEW IF EXISTS keg_aging_report CASCADE;
DROP VIEW IF EXISTS customer_keg_transaction_history CASCADE;
DROP VIEW IF EXISTS customer_keg_balances CASCADE;

-- Views that depend on keg_inventory (table)
DROP VIEW IF EXISTS keg_fleet_summary CASCADE;
DROP VIEW IF EXISTS keg_turnover_metrics CASCADE;
DROP VIEW IF EXISTS keg_inventory_summary CASCADE;
DROP VIEW IF EXISTS keg_inventory_with_details CASCADE;

-- Views that depend on keg_transactions directly
DROP VIEW IF EXISTS keg_transactions_with_details CASCADE;

-- The keg_inventory TABLE itself (being replaced by a calculated VIEW).
-- REPLAY FIX (PR #322): by this point keg_inventory is already a VIEW
-- (00032 replaced the 00031 table), and DROP TABLE errors on a view even
-- with IF EXISTS. Drop either relkind so the recreation below applies.
DROP VIEW IF EXISTS keg_inventory CASCADE;
DROP TABLE IF EXISTS keg_inventory CASCADE;

-- =============================================================================
-- 6. Recreate keg_inventory as a calculated VIEW
-- =============================================================================
-- Replaces the old mutable table with a calculated view following
-- the allocations pattern. Quantities derived from keg_transactions.

CREATE VIEW keg_inventory
WITH (security_invoker = true)
AS
WITH inflows AS (
  SELECT
    keg_type_id,
    keg_owner_id,
    to_state AS state,
    to_location_id AS location_id,
    batch_id,
    finished_good_id,
    SUM(quantity) AS qty
  FROM keg_transactions
  GROUP BY keg_type_id, keg_owner_id, to_state, to_location_id, batch_id, finished_good_id
),
outflows AS (
  SELECT
    keg_type_id,
    keg_owner_id,
    from_state AS state,
    from_location_id AS location_id,
    batch_id,
    finished_good_id,
    SUM(quantity) AS qty
  FROM keg_transactions
  WHERE from_state IS NOT NULL
  GROUP BY keg_type_id, keg_owner_id, from_state, from_location_id, batch_id, finished_good_id
),
combined AS (
  SELECT
    keg_type_id,
    keg_owner_id,
    state,
    location_id,
    batch_id,
    finished_good_id,
    COALESCE(SUM(qty), 0) AS quantity
  FROM (
    SELECT keg_type_id, keg_owner_id, state, location_id, batch_id, finished_good_id, qty FROM inflows
    UNION ALL
    SELECT keg_type_id, keg_owner_id, state, location_id, batch_id, finished_good_id, -qty FROM outflows
  ) sub
  GROUP BY keg_type_id, keg_owner_id, state, location_id, batch_id, finished_good_id
  HAVING COALESCE(SUM(qty), 0) > 0
)
SELECT
  gen_random_uuid() AS id,
  keg_type_id,
  keg_owner_id,
  state::keg_state,
  location_id,
  quantity::INTEGER,
  batch_id,
  finished_good_id
FROM combined;

-- =============================================================================
-- 7. Create keg_inventory_with_details VIEW (new)
-- =============================================================================

CREATE VIEW keg_inventory_with_details
WITH (security_invoker = true)
AS
SELECT
  ki.id,
  ki.keg_type_id,
  ki.keg_owner_id,
  ki.state,
  ki.location_id,
  ki.quantity,
  ki.batch_id,
  ki.finished_good_id,
  kt.name AS keg_type_name,
  kt.code AS keg_type_code,
  kt.volume_bbl,
  ko.name AS keg_owner_name,
  ko.code AS keg_owner_code,
  l.name AS location_name,
  b.batch_number,
  fg_brand.name AS finished_good_name
FROM keg_inventory ki
JOIN keg_types kt ON kt.id = ki.keg_type_id
LEFT JOIN keg_owners ko ON ko.id = ki.keg_owner_id
LEFT JOIN locations l ON l.id = ki.location_id
LEFT JOIN batches b ON b.id = ki.batch_id
LEFT JOIN finished_goods fg ON fg.id = ki.finished_good_id
LEFT JOIN brands fg_brand ON fg.brand_id = fg_brand.id;

-- =============================================================================
-- 8. Recreate keg_transactions_with_details
-- =============================================================================
-- Matches production column list exactly + adds keg_owner columns

CREATE VIEW keg_transactions_with_details
WITH (security_invoker = true)
AS
SELECT
  kt.id,
  kt.transaction_type,
  kt.keg_type_id,
  kt.quantity,
  kt.from_state,
  kt.to_state,
  kt.from_location_id,
  kt.to_location_id,
  kt.order_id,
  kt.customer_id,
  kt.packaging_session_id,
  kt.batch_id,
  kt.finished_good_id,
  kt.keg_owner_id,
  kt.notes,
  kt.created_by_name,
  kt.created_at,
  ktype.name AS keg_type_name,
  ktype.code AS keg_type_code,
  ktype.volume_bbl,
  ko.name AS keg_owner_name,
  ko.code AS keg_owner_code,
  c.name AS customer_name,
  o.order_number,
  b.batch_number,
  fg.lot_number AS finished_good_lot,
  fg_brand.name AS finished_good_brand,
  fg_brand.name AS finished_good_name,
  fl.name AS from_location_name,
  tl.name AS to_location_name,
  tl.name AS location_name
FROM keg_transactions kt
LEFT JOIN keg_types ktype ON kt.keg_type_id = ktype.id
LEFT JOIN keg_owners ko ON kt.keg_owner_id = ko.id
LEFT JOIN customers c ON kt.customer_id = c.id
LEFT JOIN orders o ON kt.order_id = o.id
LEFT JOIN batches b ON kt.batch_id = b.id
LEFT JOIN finished_goods fg ON kt.finished_good_id = fg.id
LEFT JOIN brands fg_brand ON fg.brand_id = fg_brand.id
LEFT JOIN locations fl ON kt.from_location_id = fl.id
LEFT JOIN locations tl ON kt.to_location_id = tl.id
ORDER BY kt.created_at DESC;

-- =============================================================================
-- 9. Recreate keg_inventory_summary
-- =============================================================================
-- Matches production: starts from keg_types LEFT JOIN keg_inventory
-- Adds keg_owner dimension

CREATE VIEW keg_inventory_summary
WITH (security_invoker = true)
AS
SELECT
  kt.id AS keg_type_id,
  kt.name AS keg_type_name,
  kt.code AS keg_type_code,
  kt.volume_bbl,
  ki.keg_owner_id,
  ko.name AS keg_owner_name,
  ki.state,
  COALESCE(SUM(ki.quantity), 0) AS total_quantity,
  COUNT(DISTINCT ki.location_id) AS location_count
FROM keg_types kt
LEFT JOIN keg_inventory ki ON kt.id = ki.keg_type_id
LEFT JOIN keg_owners ko ON ki.keg_owner_id = ko.id
WHERE kt.is_active = true
GROUP BY kt.id, kt.name, kt.code, kt.volume_bbl, ki.keg_owner_id, ko.name, ki.state
ORDER BY kt."position", kt.name, ki.state;

-- =============================================================================
-- 10. Recreate customer_keg_balances with owner dimension
-- =============================================================================
-- Matches production CTE approach + adds keg_owner grouping + deposit override

CREATE VIEW customer_keg_balances
WITH (security_invoker = true)
AS
WITH balance_changes AS (
  SELECT customer_id, keg_type_id, keg_owner_id, quantity AS delta
  FROM keg_transactions
  WHERE transaction_type = 'ship' AND customer_id IS NOT NULL
  UNION ALL
  SELECT customer_id, keg_type_id, keg_owner_id, -quantity AS delta
  FROM keg_transactions
  WHERE transaction_type = 'return' AND customer_id IS NOT NULL
)
SELECT
  c.id AS customer_id,
  c.name AS customer_name,
  kt.id AS keg_type_id,
  kt.name AS keg_type_name,
  kt.code AS keg_type_code,
  kt.volume_bbl,
  bc.keg_owner_id,
  ko.name AS keg_owner_name,
  COALESCE(kod.deposit_amount, kt.deposit_amount) AS deposit_amount,
  SUM(bc.delta) AS kegs_out,
  SUM(bc.delta)::numeric * COALESCE(kod.deposit_amount, kt.deposit_amount, 0::numeric) AS deposit_value
FROM customers c
JOIN balance_changes bc ON c.id = bc.customer_id
JOIN keg_types kt ON bc.keg_type_id = kt.id
LEFT JOIN keg_owners ko ON bc.keg_owner_id = ko.id
LEFT JOIN keg_owner_deposits kod
  ON kod.keg_owner_id = bc.keg_owner_id
  AND kod.keg_type_id = bc.keg_type_id
WHERE kt.is_active = true
GROUP BY c.id, c.name, kt.id, kt.name, kt.code, kt.volume_bbl,
         bc.keg_owner_id, ko.name, kod.deposit_amount, kt.deposit_amount
HAVING SUM(bc.delta) <> 0
ORDER BY c.name, kt.name;

-- =============================================================================
-- 11. Recreate customer_keg_balance_summary
-- =============================================================================

CREATE VIEW customer_keg_balance_summary
WITH (security_invoker = true)
AS
SELECT
  customer_id,
  customer_name,
  SUM(kegs_out) AS total_kegs_out,
  SUM(deposit_value) AS total_deposit_value,
  COUNT(DISTINCT keg_type_id) AS keg_type_count
FROM customer_keg_balances
GROUP BY customer_id, customer_name
ORDER BY customer_name;

-- =============================================================================
-- 12. Recreate customers_with_order_summary
-- =============================================================================
-- Exact reproduction of production view (complex LATERAL joins)

CREATE VIEW customers_with_order_summary
WITH (security_invoker = true)
AS
SELECT
  c.id,
  c.name,
  c.customer_type,
  c.contact_name,
  c.email,
  c.phone,
  c.address,
  c.notes,
  c.is_active,
  c.created_at,
  c.updated_at,
  c.sales_channel_id,
  c.price_tier_id,
  sc.name AS sales_channel_name,
  pt.name AS price_tier_name,
  COALESCE(order_stats.total_orders, 0) AS total_orders,
  COALESCE(order_stats.total_revenue, 0::numeric) AS total_revenue,
  order_stats.last_order_date,
  COALESCE(order_stats.pending_orders, 0) AS pending_orders,
  COALESCE(order_stats.pending_revenue, 0::numeric) AS pending_revenue,
  COALESCE(kb.total_kegs_out, 0::numeric)::integer AS total_kegs_out,
  COALESCE(kb.total_deposit_value, 0::numeric)::numeric(10,2) AS total_deposit_value
FROM customers c
LEFT JOIN sales_channels sc ON c.sales_channel_id = sc.id
LEFT JOIN pricing_tiers pt ON c.price_tier_id = pt.id
LEFT JOIN LATERAL (
  SELECT
    count(*)::integer AS total_orders,
    sum(
      CASE
        WHEN o.status = ANY (ARRAY['fulfilled', 'out_the_door'])
        THEN COALESCE((SELECT sum(oi.quantity::numeric * oi.unit_price) FROM order_items oi WHERE oi.order_id = o.id), 0::numeric)
        ELSE 0::numeric
      END
    ) AS total_revenue,
    max(o.order_date) AS last_order_date,
    count(*) FILTER (WHERE o.status <> ALL (ARRAY['fulfilled', 'out_the_door', 'cancelled']))::integer AS pending_orders,
    sum(
      CASE
        WHEN o.status <> ALL (ARRAY['fulfilled', 'out_the_door', 'cancelled'])
        THEN COALESCE((SELECT sum(oi.quantity::numeric * oi.unit_price) FROM order_items oi WHERE oi.order_id = o.id), 0::numeric)
        ELSE 0::numeric
      END
    ) AS pending_revenue
  FROM orders o
  WHERE o.customer_id = c.id
) order_stats ON true
LEFT JOIN customer_keg_balance_summary kb ON c.id = kb.customer_id;

-- =============================================================================
-- 13. Recreate customer_keg_transaction_history with owner
-- =============================================================================
-- Matches production explicit column list + adds keg_owner columns

CREATE VIEW customer_keg_transaction_history
WITH (security_invoker = true)
AS
SELECT
  kt.id,
  kt.transaction_type,
  kt.keg_type_id,
  ktype.name AS keg_type_name,
  ktype.code AS keg_type_code,
  ktype.volume_bbl,
  kt.keg_owner_id,
  ko.name AS keg_owner_name,
  kt.quantity,
  kt.from_state,
  kt.to_state,
  kt.customer_id,
  c.name AS customer_name,
  kt.order_id,
  o.order_number,
  kt.notes,
  kt.created_by_name,
  kt.created_at
FROM keg_transactions kt
JOIN keg_types ktype ON kt.keg_type_id = ktype.id
LEFT JOIN keg_owners ko ON kt.keg_owner_id = ko.id
LEFT JOIN customers c ON kt.customer_id = c.id
LEFT JOIN orders o ON kt.order_id = o.id
WHERE kt.customer_id IS NOT NULL
  AND kt.transaction_type IN ('ship', 'return')
ORDER BY kt.created_at DESC;

-- =============================================================================
-- 14. Recreate keg_aging_report with owner dimension
-- =============================================================================
-- Matches production CTE approach + adds keg_owner dimension + deposit override

CREATE VIEW keg_aging_report
WITH (security_invoker = true)
AS
WITH shipped_kegs AS (
  SELECT
    kt.customer_id,
    kt.keg_type_id,
    kt.keg_owner_id,
    kt.created_at AS shipped_at,
    kt.quantity AS shipped_qty,
    kt.order_id
  FROM keg_transactions kt
  WHERE kt.transaction_type = 'ship' AND kt.customer_id IS NOT NULL
),
returned_kegs AS (
  SELECT
    customer_id,
    keg_type_id,
    keg_owner_id,
    SUM(quantity) AS returned_qty
  FROM keg_transactions
  WHERE transaction_type = 'return' AND customer_id IS NOT NULL
  GROUP BY customer_id, keg_type_id, keg_owner_id
),
keg_balances AS (
  SELECT
    s.customer_id,
    s.keg_type_id,
    s.keg_owner_id,
    s.shipped_at,
    s.order_id,
    s.shipped_qty,
    COALESCE(r.returned_qty, 0::bigint) AS total_returned,
    EXTRACT(DAY FROM NOW() - s.shipped_at)::integer AS days_out
  FROM shipped_kegs s
  LEFT JOIN returned_kegs r
    ON s.customer_id = r.customer_id
    AND s.keg_type_id = r.keg_type_id
    AND COALESCE(s.keg_owner_id::text, '') = COALESCE(r.keg_owner_id::text, '')
)
SELECT
  kb.customer_id,
  c.name AS customer_name,
  kb.keg_type_id,
  kt.name AS keg_type_name,
  kt.code AS keg_type_code,
  kb.keg_owner_id,
  ko.name AS keg_owner_name,
  COALESCE(kod.deposit_amount, kt.deposit_amount) AS deposit_amount,
  ckb.kegs_out,
  kb.days_out,
  CASE
    WHEN kb.days_out > 90 THEN 'critical'::text
    WHEN kb.days_out > 60 THEN 'warning'::text
    WHEN kb.days_out > 30 THEN 'attention'::text
    ELSE 'normal'::text
  END AS aging_status,
  ckb.kegs_out::numeric * COALESCE(kod.deposit_amount, kt.deposit_amount, 0::numeric) AS deposit_at_risk
FROM keg_balances kb
JOIN customers c ON kb.customer_id = c.id
JOIN keg_types kt ON kb.keg_type_id = kt.id
LEFT JOIN keg_owners ko ON kb.keg_owner_id = ko.id
LEFT JOIN keg_owner_deposits kod
  ON kod.keg_owner_id = kb.keg_owner_id
  AND kod.keg_type_id = kb.keg_type_id
JOIN customer_keg_balances ckb
  ON kb.customer_id = ckb.customer_id
  AND kb.keg_type_id = ckb.keg_type_id
  AND COALESCE(kb.keg_owner_id::text, '') = COALESCE(ckb.keg_owner_id::text, '')
WHERE ckb.kegs_out > 0
ORDER BY kb.days_out DESC, c.name;

-- =============================================================================
-- 15. Recreate keg_fleet_summary with owner dimension
-- =============================================================================
-- Matches production structure + adds keg_owner grouping + deposit override

CREATE VIEW keg_fleet_summary
WITH (security_invoker = true)
AS
SELECT
  kt.id AS keg_type_id,
  kt.name AS keg_type_name,
  kt.code AS keg_type_code,
  kt.volume_bbl,
  ki.keg_owner_id,
  ko.name AS keg_owner_name,
  COALESCE(kod.deposit_amount, kt.deposit_amount) AS deposit_amount,
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state = 'empty'::keg_state), 0::bigint)::integer AS empty_count,
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state = 'filled'::keg_state), 0::bigint)::integer AS filled_count,
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state = 'shipped'::keg_state), 0::bigint)::integer AS shipped_count,
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state = 'returned_dirty'::keg_state), 0::bigint)::integer AS dirty_count,
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state = 'cleaning'::keg_state), 0::bigint)::integer AS cleaning_count,
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state = 'maintenance'::keg_state), 0::bigint)::integer AS maintenance_count,
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state = 'retired'::keg_state), 0::bigint)::integer AS retired_count,
  COALESCE(SUM(ki.quantity), 0::bigint)::integer AS total_kegs,
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state <> ALL (ARRAY['retired'::keg_state, 'maintenance'::keg_state])), 0::bigint)::integer AS active_kegs,
  CASE
    WHEN COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state <> ALL (ARRAY['retired'::keg_state, 'maintenance'::keg_state])), 0::bigint) > 0
    THEN (COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state = ANY (ARRAY['filled'::keg_state, 'shipped'::keg_state])), 0::bigint)::numeric
          / COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state <> ALL (ARRAY['retired'::keg_state, 'maintenance'::keg_state])), 1::bigint)::numeric
          * 100::numeric)::numeric(5,1)
    ELSE 0::numeric
  END AS utilization_pct,
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state = 'shipped'::keg_state), 0::bigint)::numeric
    * COALESCE(kod.deposit_amount, kt.deposit_amount, 0::numeric) AS deposits_outstanding
FROM keg_types kt
LEFT JOIN keg_inventory ki ON kt.id = ki.keg_type_id
LEFT JOIN keg_owners ko ON ki.keg_owner_id = ko.id
LEFT JOIN keg_owner_deposits kod
  ON kod.keg_owner_id = ki.keg_owner_id
  AND kod.keg_type_id = kt.id
WHERE kt.is_active = true
GROUP BY kt.id, kt.name, kt.code, kt.volume_bbl,
         ki.keg_owner_id, ko.name,
         kod.deposit_amount, kt.deposit_amount
ORDER BY kt.name;

-- =============================================================================
-- 16. Recreate keg_turnover_metrics with owner dimension
-- =============================================================================
-- Matches production CTE approach + adds keg_owner pairing/grouping

CREATE VIEW keg_turnover_metrics
WITH (security_invoker = true)
AS
WITH transaction_pairs AS (
  SELECT
    ship.keg_type_id,
    ship.keg_owner_id,
    ship.customer_id,
    ship.created_at AS shipped_at,
    ret.created_at AS returned_at,
    EXTRACT(DAY FROM ret.created_at - ship.created_at)::integer AS cycle_days
  FROM keg_transactions ship
  JOIN keg_transactions ret
    ON ret.customer_id = ship.customer_id
    AND ret.keg_type_id = ship.keg_type_id
    AND COALESCE(ret.keg_owner_id::text, '') = COALESCE(ship.keg_owner_id::text, '')
    AND ret.transaction_type = 'return'
    AND ret.created_at > ship.created_at
  WHERE ship.transaction_type = 'ship'
    AND ship.created_at > (NOW() - '365 days'::interval)
)
SELECT
  kt.id AS keg_type_id,
  kt.name AS keg_type_name,
  kt.code AS keg_type_code,
  tp.keg_owner_id,
  ko.name AS keg_owner_name,
  COUNT(tp.cycle_days) AS completed_cycles,
  COALESCE(AVG(tp.cycle_days), 0::numeric)::numeric(10,1) AS avg_cycle_days,
  COALESCE(MIN(tp.cycle_days), 0) AS min_cycle_days,
  COALESCE(MAX(tp.cycle_days), 0) AS max_cycle_days,
  CASE
    WHEN COALESCE(AVG(tp.cycle_days), 0::numeric) > 0::numeric
    THEN (365.0 / AVG(tp.cycle_days))::numeric(10,2)
    ELSE 0::numeric
  END AS annual_turnover_rate
FROM keg_types kt
LEFT JOIN transaction_pairs tp ON kt.id = tp.keg_type_id
LEFT JOIN keg_owners ko ON tp.keg_owner_id = ko.id
WHERE kt.is_active = true
GROUP BY kt.id, kt.name, kt.code, tp.keg_owner_id, ko.name
ORDER BY kt.name;

-- =============================================================================
-- 17. Update _schema_registry
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships)
VALUES
  ('keg_owners', 'Fleet provider definitions (Owned, Microstar, KegFleet, etc.)', 'inventory',
   '{"referenced_by": ["keg_transactions", "keg_owner_deposits", "order_items"]}'),
  ('keg_owner_deposits', 'Per-owner per-keg-type deposit amounts (overrides keg_types.deposit_amount)', 'inventory',
   '{"belongs_to": ["keg_owners", "keg_types"]}')
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships;

-- Update existing entries to note owner dimension
UPDATE _schema_registry
SET description = 'Immutable audit log for keg state transitions (includes keg_owner_id for fleet tracking)'
WHERE table_name = 'keg_transactions';
