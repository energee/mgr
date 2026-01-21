-- Keg Transactions Table
-- Phase 10.3: Audit log for all keg state transitions and movements

-- =============================================================================
-- 1. TRANSACTION TYPE ENUM
-- =============================================================================

CREATE TYPE keg_transaction_type AS ENUM (
  'fill',      -- Filling empty kegs from a batch (empty -> filled)
  'ship',      -- Shipping filled kegs to customer (filled -> shipped)
  'return',    -- Customer returns kegs (shipped -> returned_dirty)
  'clean',     -- Cleaning dirty kegs (returned_dirty -> cleaning -> empty)
  'receive',   -- Receiving new kegs into inventory (-> empty)
  'adjust',    -- Manual inventory adjustment
  'retire',    -- Retiring kegs from service (-> retired)
  'maintain'   -- Sending kegs to maintenance (-> maintenance)
);

-- =============================================================================
-- 2. KEG_TRANSACTIONS TABLE
-- =============================================================================

CREATE TABLE keg_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Transaction details
  transaction_type keg_transaction_type NOT NULL,
  keg_type_id UUID NOT NULL REFERENCES keg_types(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),

  -- State transition
  from_state keg_state,  -- NULL for 'receive' (new kegs entering system)
  to_state keg_state NOT NULL,

  -- Location tracking
  from_location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  to_location_id UUID REFERENCES locations(id) ON DELETE SET NULL,

  -- Related entities (depends on transaction type)
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  packaging_session_id UUID REFERENCES packaging_sessions(id) ON DELETE SET NULL,
  batch_id UUID REFERENCES batches(id) ON DELETE SET NULL,
  finished_good_id UUID REFERENCES finished_goods(id) ON DELETE SET NULL,

  -- Audit fields
  notes TEXT,
  created_by_name TEXT,  -- Cached user name for display
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints based on transaction type
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

COMMENT ON TABLE keg_transactions IS 'Audit log for all keg state transitions and movements';
COMMENT ON COLUMN keg_transactions.transaction_type IS 'Type of transaction (fill, ship, return, clean, receive, adjust)';
COMMENT ON COLUMN keg_transactions.from_state IS 'State before transaction (NULL for receive)';
COMMENT ON COLUMN keg_transactions.to_state IS 'State after transaction';
COMMENT ON COLUMN keg_transactions.created_by_name IS 'Cached name of user who created the transaction';

-- =============================================================================
-- 3. ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE keg_transactions ENABLE ROW LEVEL SECURITY;

-- Note: Single-tenant application - all authenticated users have full access.
-- This follows the pattern established in other tables.
-- Admin-level access control is enforced in the application layer.

CREATE POLICY "keg_transactions_select" ON keg_transactions
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "keg_transactions_insert" ON keg_transactions
  FOR INSERT TO authenticated WITH CHECK (true);

-- Transactions are immutable audit records - no update policy
-- Only allow delete for admins (handled in application layer)
CREATE POLICY "keg_transactions_delete" ON keg_transactions
  FOR DELETE TO authenticated USING (true);

-- =============================================================================
-- 4. INDEXES
-- =============================================================================

CREATE INDEX idx_keg_transactions_type ON keg_transactions(transaction_type);
CREATE INDEX idx_keg_transactions_keg_type ON keg_transactions(keg_type_id);
CREATE INDEX idx_keg_transactions_created_at ON keg_transactions(created_at DESC);
CREATE INDEX idx_keg_transactions_customer ON keg_transactions(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX idx_keg_transactions_order ON keg_transactions(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX idx_keg_transactions_batch ON keg_transactions(batch_id) WHERE batch_id IS NOT NULL;

-- =============================================================================
-- 5. HELPER VIEW FOR DISPLAY
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
  fl.name AS from_location_name,
  tl.name AS to_location_name
FROM keg_transactions kt
LEFT JOIN keg_types ktype ON kt.keg_type_id = ktype.id
LEFT JOIN customers c ON kt.customer_id = c.id
LEFT JOIN orders o ON kt.order_id = o.id
LEFT JOIN batches b ON kt.batch_id = b.id
LEFT JOIN finished_goods fg ON kt.finished_good_id = fg.id
LEFT JOIN locations fl ON kt.from_location_id = fl.id
LEFT JOIN locations tl ON kt.to_location_id = tl.id
ORDER BY kt.created_at DESC;

COMMENT ON VIEW keg_transactions_with_details IS 'Keg transactions with joined display names';

-- =============================================================================
-- 6. FUNCTION TO RECORD TRANSACTION AND UPDATE INVENTORY
-- =============================================================================

CREATE OR REPLACE FUNCTION record_keg_transaction(
  p_transaction_type keg_transaction_type,
  p_keg_type_id UUID,
  p_quantity INTEGER,
  p_from_state keg_state DEFAULT NULL,
  p_to_state keg_state DEFAULT NULL,
  p_from_location_id UUID DEFAULT NULL,
  p_to_location_id UUID DEFAULT NULL,
  p_order_id UUID DEFAULT NULL,
  p_customer_id UUID DEFAULT NULL,
  p_packaging_session_id UUID DEFAULT NULL,
  p_batch_id UUID DEFAULT NULL,
  p_finished_good_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_created_by_name TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_transaction_id UUID;
BEGIN
  -- Insert the transaction record
  INSERT INTO keg_transactions (
    transaction_type, keg_type_id, quantity,
    from_state, to_state,
    from_location_id, to_location_id,
    order_id, customer_id, packaging_session_id,
    batch_id, finished_good_id,
    notes, created_by_name
  ) VALUES (
    p_transaction_type, p_keg_type_id, p_quantity,
    p_from_state, p_to_state,
    p_from_location_id, p_to_location_id,
    p_order_id, p_customer_id, p_packaging_session_id,
    p_batch_id, p_finished_good_id,
    p_notes, p_created_by_name
  )
  RETURNING id INTO v_transaction_id;

  -- Decrement from source inventory (if from_state is specified)
  IF p_from_state IS NOT NULL THEN
    UPDATE keg_inventory
    SET quantity = quantity - p_quantity,
        updated_at = NOW()
    WHERE keg_type_id = p_keg_type_id
      AND state = p_from_state
      AND COALESCE(location_id, '00000000-0000-0000-0000-000000000000') = COALESCE(p_from_location_id, '00000000-0000-0000-0000-000000000000')
      AND COALESCE(batch_id, '00000000-0000-0000-0000-000000000000') = COALESCE(p_batch_id, '00000000-0000-0000-0000-000000000000')
      AND COALESCE(finished_good_id, '00000000-0000-0000-0000-000000000000') = COALESCE(p_finished_good_id, '00000000-0000-0000-0000-000000000000');
  END IF;

  -- Increment destination inventory (explicit update/insert to handle NULLs correctly)
  -- PostgreSQL treats NULLs as distinct in unique constraints, so ON CONFLICT won't match
  UPDATE keg_inventory
  SET quantity = quantity + p_quantity,
      updated_at = NOW()
  WHERE keg_type_id = p_keg_type_id
    AND state = p_to_state
    AND COALESCE(location_id, '00000000-0000-0000-0000-000000000000') = COALESCE(p_to_location_id, '00000000-0000-0000-0000-000000000000')
    AND COALESCE(batch_id, '00000000-0000-0000-0000-000000000000') = COALESCE(CASE WHEN p_to_state = 'filled' THEN p_batch_id ELSE NULL END, '00000000-0000-0000-0000-000000000000')
    AND COALESCE(finished_good_id, '00000000-0000-0000-0000-000000000000') = COALESCE(CASE WHEN p_to_state = 'filled' THEN p_finished_good_id ELSE NULL END, '00000000-0000-0000-0000-000000000000');

  -- If no row was updated, insert a new one
  IF NOT FOUND THEN
    INSERT INTO keg_inventory (
      keg_type_id, state, location_id, quantity,
      batch_id, finished_good_id
    ) VALUES (
      p_keg_type_id, p_to_state, p_to_location_id, p_quantity,
      CASE WHEN p_to_state = 'filled' THEN p_batch_id ELSE NULL END,
      CASE WHEN p_to_state = 'filled' THEN p_finished_good_id ELSE NULL END
    );
  END IF;

  RETURN v_transaction_id;
END;
$$;

COMMENT ON FUNCTION record_keg_transaction IS 'Records a keg transaction and updates inventory atomically';

-- =============================================================================
-- 7. SCHEMA REGISTRY
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields, query_examples)
VALUES
  ('keg_transactions', 'Audit log for keg state transitions and movements', 'inventory',
   '{"keg_types": "keg_type_id", "customers": "customer_id", "orders": "order_id", "batches": "batch_id", "finished_goods": "finished_good_id", "locations": "from_location_id, to_location_id"}'::jsonb,
   '["id", "transaction_type", "keg_type_id", "quantity", "from_state", "to_state", "created_at"]'::jsonb,
   '["Show recent keg transactions", "How many kegs were shipped this month?", "List all keg returns from customer X"]'::jsonb)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships,
  key_fields = EXCLUDED.key_fields,
  query_examples = EXCLUDED.query_examples;
