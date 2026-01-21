-- Keg Transactions Table
-- Phase 10.3: Immutable audit log for all keg state transitions
--
-- DESIGN: Following the unified allocations pattern from CLAUDE.md:
-- "All inventory movements via unified allocations table. Quantities calculated via views,
-- never stored as mutable balances."
--
-- Keg transactions are immutable records. Keg inventory quantities are CALCULATED
-- from these transactions via a view, not stored as mutable balances.

-- =============================================================================
-- 1. DROP MUTABLE INVENTORY TABLE
-- =============================================================================
-- The keg_inventory table from migration 00031 stored mutable quantities.
-- We replace it with a calculated view to follow the allocations pattern.

DROP VIEW IF EXISTS keg_inventory_summary;
DROP TRIGGER IF EXISTS set_keg_inventory_updated_at ON keg_inventory;
DROP TABLE IF EXISTS keg_inventory;

-- =============================================================================
-- 2. TRANSACTION TYPE ENUM
-- =============================================================================

CREATE TYPE keg_transaction_type AS ENUM (
  'receive',   -- New kegs entering inventory (-> empty)
  'fill',      -- Filling empty kegs from a batch (empty -> filled)
  'ship',      -- Shipping filled kegs to customer (filled -> shipped)
  'return',    -- Customer returns kegs (shipped -> returned_dirty)
  'clean',     -- Cleaning dirty kegs (returned_dirty -> cleaning -> empty)
  'adjust',    -- Manual inventory adjustment (any state)
  'retire',    -- Retiring kegs from service (any -> retired)
  'maintain'   -- Sending kegs to maintenance (any -> maintenance)
);

-- =============================================================================
-- 3. KEG_TRANSACTIONS TABLE (Immutable Audit Records)
-- =============================================================================

CREATE TABLE keg_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Transaction details
  transaction_type keg_transaction_type NOT NULL,
  keg_type_id UUID NOT NULL REFERENCES keg_types(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),

  -- State transition (to_state is the resulting state)
  from_state keg_state,  -- NULL for 'receive' (new kegs entering system)
  to_state keg_state NOT NULL,

  -- Location tracking
  location_id UUID REFERENCES locations(id) ON DELETE SET NULL,

  -- Related entities (depends on transaction type)
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  packaging_session_id UUID REFERENCES packaging_sessions(id) ON DELETE SET NULL,
  batch_id UUID REFERENCES batches(id) ON DELETE SET NULL,
  finished_good_id UUID REFERENCES finished_goods(id) ON DELETE SET NULL,

  -- Audit fields
  notes TEXT,
  created_by_name TEXT,  -- Cached user name for display (per CLAUDE.md: never join auth.users)
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints based on transaction type to ensure data integrity
  CONSTRAINT valid_fill_transaction CHECK (
    transaction_type != 'fill' OR (
      from_state = 'empty' AND
      to_state = 'filled' AND
      (batch_id IS NOT NULL OR finished_good_id IS NOT NULL)
    )
  ),
  CONSTRAINT valid_ship_transaction CHECK (
    transaction_type != 'ship' OR (
      from_state = 'filled' AND
      to_state = 'shipped' AND
      customer_id IS NOT NULL
    )
  ),
  CONSTRAINT valid_return_transaction CHECK (
    transaction_type != 'return' OR (
      from_state = 'shipped' AND
      to_state = 'returned_dirty' AND
      customer_id IS NOT NULL
    )
  ),
  CONSTRAINT valid_clean_transaction CHECK (
    transaction_type != 'clean' OR (
      from_state IN ('returned_dirty', 'cleaning') AND
      to_state IN ('cleaning', 'empty')
    )
  ),
  CONSTRAINT valid_receive_transaction CHECK (
    transaction_type != 'receive' OR (
      from_state IS NULL AND
      to_state = 'empty'
    )
  ),
  CONSTRAINT valid_retire_transaction CHECK (
    transaction_type != 'retire' OR to_state = 'retired'
  ),
  CONSTRAINT valid_maintain_transaction CHECK (
    transaction_type != 'maintain' OR to_state = 'maintenance'
  )
);

COMMENT ON TABLE keg_transactions IS 'Immutable audit log for all keg state transitions. Inventory quantities are calculated from these records.';
COMMENT ON COLUMN keg_transactions.transaction_type IS 'Type of transaction (receive, fill, ship, return, clean, adjust, retire, maintain)';
COMMENT ON COLUMN keg_transactions.from_state IS 'State before transaction (NULL for receive)';
COMMENT ON COLUMN keg_transactions.to_state IS 'State after transaction';
COMMENT ON COLUMN keg_transactions.created_by_name IS 'Cached name of user who created the transaction';

-- =============================================================================
-- 4. ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE keg_transactions ENABLE ROW LEVEL SECURITY;

-- Note: Single-tenant application - all authenticated users have full access.
-- This follows the pattern established in other tables.
-- Admin-level access control is enforced in the application layer.

CREATE POLICY "keg_transactions_select" ON keg_transactions
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "keg_transactions_insert" ON keg_transactions
  FOR INSERT TO authenticated WITH CHECK (true);

-- Transactions are IMMUTABLE audit records - no update or delete policies
-- This ensures complete audit trail integrity

-- =============================================================================
-- 5. INDEXES
-- =============================================================================

CREATE INDEX idx_keg_transactions_type ON keg_transactions(transaction_type);
CREATE INDEX idx_keg_transactions_keg_type ON keg_transactions(keg_type_id);
CREATE INDEX idx_keg_transactions_to_state ON keg_transactions(to_state);
CREATE INDEX idx_keg_transactions_created_at ON keg_transactions(created_at DESC);
CREATE INDEX idx_keg_transactions_customer ON keg_transactions(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX idx_keg_transactions_order ON keg_transactions(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX idx_keg_transactions_batch ON keg_transactions(batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX idx_keg_transactions_location ON keg_transactions(location_id) WHERE location_id IS NOT NULL;

-- =============================================================================
-- 6. CALCULATED INVENTORY VIEW
-- =============================================================================
-- Following the allocations pattern: quantities are CALCULATED from transactions,
-- never stored as mutable balances.
--
-- For each keg_type + state + location combination, we calculate:
-- - Kegs entering this state (to_state matches)
-- - Kegs leaving this state (from_state matches)
-- - Net quantity = entered - left

CREATE VIEW keg_inventory
WITH (security_invoker = true)
AS
WITH state_changes AS (
  -- Kegs entering each state (positive)
  SELECT
    keg_type_id,
    to_state AS state,
    location_id,
    -- For filled kegs, track the batch/finished_good
    CASE WHEN to_state = 'filled' THEN batch_id ELSE NULL END AS batch_id,
    CASE WHEN to_state = 'filled' THEN finished_good_id ELSE NULL END AS finished_good_id,
    quantity AS delta
  FROM keg_transactions

  UNION ALL

  -- Kegs leaving each state (negative)
  SELECT
    keg_type_id,
    from_state AS state,
    location_id,
    CASE WHEN from_state = 'filled' THEN batch_id ELSE NULL END AS batch_id,
    CASE WHEN from_state = 'filled' THEN finished_good_id ELSE NULL END AS finished_good_id,
    -quantity AS delta
  FROM keg_transactions
  WHERE from_state IS NOT NULL
)
SELECT
  -- Generate a deterministic UUID for each combination
  md5(
    COALESCE(keg_type_id::text, '') || '|' ||
    COALESCE(state::text, '') || '|' ||
    COALESCE(location_id::text, 'null') || '|' ||
    COALESCE(batch_id::text, 'null') || '|' ||
    COALESCE(finished_good_id::text, 'null')
  )::uuid AS id,
  keg_type_id,
  state,
  location_id,
  batch_id,
  finished_good_id,
  SUM(delta) AS quantity
FROM state_changes
WHERE state IS NOT NULL
GROUP BY keg_type_id, state, location_id, batch_id, finished_good_id
HAVING SUM(delta) > 0;  -- Only show rows with positive inventory

COMMENT ON VIEW keg_inventory IS 'Calculated keg inventory by type, state, and location. Quantities derived from keg_transactions.';

-- =============================================================================
-- 7. TRANSACTIONS WITH DETAILS VIEW
-- =============================================================================

CREATE VIEW keg_transactions_with_details
WITH (security_invoker = true)
AS
SELECT
  kt.*,
  ktype.name AS keg_type_name,
  ktype.code AS keg_type_code,
  ktype.volume_bbl,
  c.name AS customer_name,
  o.order_number,
  b.batch_number,
  fg.name AS finished_good_name,
  l.name AS location_name
FROM keg_transactions kt
LEFT JOIN keg_types ktype ON kt.keg_type_id = ktype.id
LEFT JOIN customers c ON kt.customer_id = c.id
LEFT JOIN orders o ON kt.order_id = o.id
LEFT JOIN batches b ON kt.batch_id = b.id
LEFT JOIN finished_goods fg ON kt.finished_good_id = fg.id
LEFT JOIN locations l ON kt.location_id = l.id
ORDER BY kt.created_at DESC;

COMMENT ON VIEW keg_transactions_with_details IS 'Keg transactions with joined display names';

-- =============================================================================
-- 8. INVENTORY SUMMARY VIEW
-- =============================================================================

CREATE VIEW keg_inventory_summary
WITH (security_invoker = true)
AS
SELECT
  kt.id AS keg_type_id,
  kt.name AS keg_type_name,
  kt.code AS keg_type_code,
  kt.volume_bbl,
  ki.state,
  COALESCE(SUM(ki.quantity), 0)::INTEGER AS total_quantity,
  COUNT(DISTINCT ki.location_id) AS location_count
FROM keg_types kt
LEFT JOIN keg_inventory ki ON kt.id = ki.keg_type_id
WHERE kt.is_active = true
GROUP BY kt.id, kt.name, kt.code, kt.volume_bbl, ki.state
ORDER BY kt.position, kt.name, ki.state;

COMMENT ON VIEW keg_inventory_summary IS 'Summary of keg quantities by type and state (calculated from transactions)';

-- =============================================================================
-- 9. INVENTORY WITH DETAILS VIEW (for list display)
-- =============================================================================

CREATE VIEW keg_inventory_with_details
WITH (security_invoker = true)
AS
SELECT
  ki.*,
  kt.name AS keg_type_name,
  kt.code AS keg_type_code,
  kt.volume_bbl,
  l.name AS location_name,
  b.batch_number,
  fg.name AS finished_good_name
FROM keg_inventory ki
LEFT JOIN keg_types kt ON ki.keg_type_id = kt.id
LEFT JOIN locations l ON ki.location_id = l.id
LEFT JOIN batches b ON ki.batch_id = b.id
LEFT JOIN finished_goods fg ON ki.finished_good_id = fg.id;

COMMENT ON VIEW keg_inventory_with_details IS 'Keg inventory with joined display names';

-- =============================================================================
-- 10. SCHEMA REGISTRY
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields, query_examples)
VALUES
  ('keg_transactions', 'Immutable audit log for keg state transitions. Keg inventory is calculated from these records.', 'inventory',
   '{"keg_types": "keg_type_id", "customers": "customer_id", "orders": "order_id", "batches": "batch_id", "finished_goods": "finished_good_id", "locations": "location_id"}'::jsonb,
   '["id", "transaction_type", "keg_type_id", "quantity", "from_state", "to_state", "created_at"]'::jsonb,
   '["Show recent keg transactions", "How many kegs were shipped this month?", "List all keg returns from customer X"]'::jsonb)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships,
  key_fields = EXCLUDED.key_fields,
  query_examples = EXCLUDED.query_examples;

-- Update keg_inventory registry to note it's a calculated view
UPDATE _schema_registry
SET description = 'Calculated view of keg inventory by type, state, and location. Quantities derived from keg_transactions.',
    key_fields = '["id", "keg_type_id", "state", "location_id", "quantity"]'::jsonb
WHERE table_name = 'keg_inventory';
