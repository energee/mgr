-- Keg Reports Views
-- Phase 10.5: Reporting views for keg inventory analysis
--
-- DESIGN: Following the calculated view pattern - all metrics derived from keg_transactions

-- =============================================================================
-- 1. KEG AGING REPORT VIEW
-- =============================================================================
-- Shows kegs currently shipped to customers with days out.
-- Flags kegs that have been out longer than a threshold (default 30 days).

CREATE VIEW keg_aging_report
WITH (security_invoker = true)
AS
WITH shipped_kegs AS (
  -- Get the most recent ship transaction for each customer/keg_type combo
  -- that hasn't been fully returned yet
  SELECT
    kt.customer_id,
    kt.keg_type_id,
    kt.created_at AS shipped_at,
    kt.quantity AS shipped_qty,
    kt.order_id
  FROM keg_transactions kt
  WHERE kt.transaction_type = 'ship'
    AND kt.customer_id IS NOT NULL
),
returned_kegs AS (
  -- Sum all returns by customer/keg_type
  SELECT
    customer_id,
    keg_type_id,
    SUM(quantity) AS returned_qty
  FROM keg_transactions
  WHERE transaction_type = 'return'
    AND customer_id IS NOT NULL
  GROUP BY customer_id, keg_type_id
),
keg_balances AS (
  -- Calculate outstanding kegs per ship transaction
  SELECT
    s.customer_id,
    s.keg_type_id,
    s.shipped_at,
    s.order_id,
    s.shipped_qty,
    COALESCE(r.returned_qty, 0) AS total_returned,
    -- Note: This is a simplified calculation. In practice, you'd need FIFO matching.
    EXTRACT(DAY FROM (NOW() - s.shipped_at))::INTEGER AS days_out
  FROM shipped_kegs s
  LEFT JOIN returned_kegs r ON s.customer_id = r.customer_id AND s.keg_type_id = r.keg_type_id
)
SELECT
  kb.customer_id,
  c.name AS customer_name,
  kb.keg_type_id,
  kt.name AS keg_type_name,
  kt.code AS keg_type_code,
  kt.deposit_amount,
  ckb.kegs_out,
  kb.days_out,
  CASE
    WHEN kb.days_out > 90 THEN 'critical'
    WHEN kb.days_out > 60 THEN 'warning'
    WHEN kb.days_out > 30 THEN 'attention'
    ELSE 'normal'
  END AS aging_status,
  ckb.kegs_out * COALESCE(kt.deposit_amount, 0) AS deposit_at_risk
FROM keg_balances kb
JOIN customers c ON kb.customer_id = c.id
JOIN keg_types kt ON kb.keg_type_id = kt.id
JOIN customer_keg_balances ckb ON kb.customer_id = ckb.customer_id AND kb.keg_type_id = ckb.keg_type_id
WHERE ckb.kegs_out > 0
ORDER BY kb.days_out DESC, c.name;

COMMENT ON VIEW keg_aging_report IS 'Report showing kegs out with customers and days since shipment. Used for tracking aging/overdue kegs.';

-- =============================================================================
-- 2. KEG TURNOVER METRICS VIEW
-- =============================================================================
-- Calculates average turnover time (days from fill to return cycle).

CREATE VIEW keg_turnover_metrics
WITH (security_invoker = true)
AS
WITH transaction_pairs AS (
  -- Match ship and return transactions to calculate cycle time
  SELECT
    ship.keg_type_id,
    ship.customer_id,
    ship.created_at AS shipped_at,
    ret.created_at AS returned_at,
    EXTRACT(DAY FROM (ret.created_at - ship.created_at))::INTEGER AS cycle_days
  FROM keg_transactions ship
  JOIN keg_transactions ret ON
    ret.customer_id = ship.customer_id
    AND ret.keg_type_id = ship.keg_type_id
    AND ret.transaction_type = 'return'
    AND ret.created_at > ship.created_at
  WHERE ship.transaction_type = 'ship'
    AND ship.created_at > NOW() - INTERVAL '365 days'  -- Last year only
)
SELECT
  kt.id AS keg_type_id,
  kt.name AS keg_type_name,
  kt.code AS keg_type_code,
  COUNT(tp.cycle_days) AS completed_cycles,
  COALESCE(AVG(tp.cycle_days), 0)::DECIMAL(10,1) AS avg_cycle_days,
  COALESCE(MIN(tp.cycle_days), 0) AS min_cycle_days,
  COALESCE(MAX(tp.cycle_days), 0) AS max_cycle_days,
  -- Turnover rate: 365 / avg_cycle_days (cycles per year)
  CASE
    WHEN COALESCE(AVG(tp.cycle_days), 0) > 0 THEN (365.0 / AVG(tp.cycle_days))::DECIMAL(10,2)
    ELSE 0
  END AS annual_turnover_rate
FROM keg_types kt
LEFT JOIN transaction_pairs tp ON kt.id = tp.keg_type_id
WHERE kt.is_active = true
GROUP BY kt.id, kt.name, kt.code
ORDER BY kt.name;

COMMENT ON VIEW keg_turnover_metrics IS 'Keg turnover metrics showing average cycle time and annual turnover rate by keg type.';

-- =============================================================================
-- 3. KEG FLEET SUMMARY VIEW
-- =============================================================================
-- Overall fleet statistics by keg type.

CREATE VIEW keg_fleet_summary
WITH (security_invoker = true)
AS
SELECT
  kt.id AS keg_type_id,
  kt.name AS keg_type_name,
  kt.code AS keg_type_code,
  kt.volume_bbl,
  kt.deposit_amount,
  -- Inventory counts by state
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state = 'empty'), 0)::INTEGER AS empty_count,
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state = 'filled'), 0)::INTEGER AS filled_count,
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state = 'shipped'), 0)::INTEGER AS shipped_count,
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state = 'returned_dirty'), 0)::INTEGER AS dirty_count,
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state = 'cleaning'), 0)::INTEGER AS cleaning_count,
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state = 'maintenance'), 0)::INTEGER AS maintenance_count,
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state = 'retired'), 0)::INTEGER AS retired_count,
  -- Totals
  COALESCE(SUM(ki.quantity), 0)::INTEGER AS total_kegs,
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state NOT IN ('retired', 'maintenance')), 0)::INTEGER AS active_kegs,
  -- Utilization: (filled + shipped) / active_kegs
  CASE
    WHEN COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state NOT IN ('retired', 'maintenance')), 0) > 0 THEN
      (COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state IN ('filled', 'shipped')), 0)::DECIMAL /
       COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state NOT IN ('retired', 'maintenance')), 1) * 100)::DECIMAL(5,1)
    ELSE 0
  END AS utilization_pct,
  -- Value calculations
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state = 'shipped'), 0) * COALESCE(kt.deposit_amount, 0) AS deposits_outstanding
FROM keg_types kt
LEFT JOIN keg_inventory ki ON kt.id = ki.keg_type_id
WHERE kt.is_active = true
GROUP BY kt.id, kt.name, kt.code, kt.volume_bbl, kt.deposit_amount
ORDER BY kt.name;

COMMENT ON VIEW keg_fleet_summary IS 'Summary of keg fleet by type showing inventory counts, utilization, and outstanding deposits.';

-- =============================================================================
-- 4. SCHEMA REGISTRY
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields, query_examples)
VALUES
  ('keg_aging_report', 'Report showing kegs out with customers and days since shipment. Flags aging/overdue kegs.', 'inventory',
   '{"customers": "customer_id", "keg_types": "keg_type_id"}'::jsonb,
   '["customer_id", "keg_type_id", "days_out", "aging_status"]'::jsonb,
   '["Show kegs out more than 30 days", "Find customers with aging kegs", "Total deposit value at risk"]'::jsonb),

  ('keg_turnover_metrics', 'Keg turnover metrics showing cycle time and annual turnover rate by keg type.', 'inventory',
   '{"keg_types": "keg_type_id"}'::jsonb,
   '["keg_type_id", "avg_cycle_days", "annual_turnover_rate"]'::jsonb,
   '["What is the average keg cycle time?", "Which keg types have fastest turnover?"]'::jsonb),

  ('keg_fleet_summary', 'Summary of keg fleet by type with inventory counts, utilization, and deposits.', 'inventory',
   '{"keg_types": "keg_type_id"}'::jsonb,
   '["keg_type_id", "total_kegs", "active_kegs", "utilization_pct"]'::jsonb,
   '["Total kegs by type", "Keg utilization rate", "Outstanding deposit value"]'::jsonb)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships,
  key_fields = EXCLUDED.key_fields,
  query_examples = EXCLUDED.query_examples;
