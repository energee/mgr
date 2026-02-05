-- =============================================================================
-- Migration 00080: Unify Packaging Formats & Auto-Create Keg Transactions
-- =============================================================================
--
-- 1. Add keg_type_id to order_items, session_line_items, finished_goods
-- 2. Create packaging_formats union view
-- 3. Update dependent views for keg_type_id support
-- 4. Order fulfillment trigger (auto ship keg_transactions)
-- 5. Packaging completion enhancement (auto fill keg_transactions)
-- 6. Deactivate keg entries in package_types

-- =============================================================================
-- 1. ALTER TABLES: Add keg_type_id columns and CHECK constraints
-- =============================================================================

-- order_items: package_type_id already nullable, keg_owner_id added in 00079
ALTER TABLE order_items
  ADD COLUMN keg_type_id UUID REFERENCES keg_types(id) ON DELETE SET NULL;

ALTER TABLE order_items
  ADD CONSTRAINT chk_order_item_format_xor CHECK (
    (package_type_id IS NULL AND keg_type_id IS NULL) OR
    (package_type_id IS NOT NULL AND keg_type_id IS NULL) OR
    (package_type_id IS NULL AND keg_type_id IS NOT NULL)
  );

ALTER TABLE order_items
  ADD CONSTRAINT chk_order_item_keg_owner CHECK (
    keg_owner_id IS NULL OR keg_type_id IS NOT NULL
  );

CREATE INDEX idx_order_items_keg_type ON order_items(keg_type_id)
  WHERE keg_type_id IS NOT NULL;

-- session_line_items: relax NOT NULL on package_type_id, add keg columns
ALTER TABLE session_line_items
  ALTER COLUMN package_type_id DROP NOT NULL;

ALTER TABLE session_line_items
  ADD COLUMN keg_type_id UUID REFERENCES keg_types(id) ON DELETE RESTRICT,
  ADD COLUMN keg_owner_id UUID REFERENCES keg_owners(id) ON DELETE SET NULL;

ALTER TABLE session_line_items
  ADD CONSTRAINT chk_sli_format_xor CHECK (
    (package_type_id IS NOT NULL AND keg_type_id IS NULL) OR
    (package_type_id IS NULL AND keg_type_id IS NOT NULL)
  );

ALTER TABLE session_line_items
  ADD CONSTRAINT chk_sli_keg_owner CHECK (
    keg_owner_id IS NULL OR keg_type_id IS NOT NULL
  );

-- finished_goods: relax NOT NULL on package_type_id, add keg_type_id
ALTER TABLE finished_goods
  ALTER COLUMN package_type_id DROP NOT NULL;

ALTER TABLE finished_goods
  ADD COLUMN keg_type_id UUID REFERENCES keg_types(id) ON DELETE RESTRICT;

ALTER TABLE finished_goods
  ADD CONSTRAINT chk_fg_format_xor CHECK (
    (package_type_id IS NOT NULL AND keg_type_id IS NULL) OR
    (package_type_id IS NULL AND keg_type_id IS NOT NULL)
  );

CREATE INDEX idx_finished_goods_keg_type ON finished_goods(keg_type_id)
  WHERE keg_type_id IS NOT NULL;

-- =============================================================================
-- 2. CREATE packaging_formats UNION VIEW
-- =============================================================================

CREATE VIEW packaging_formats
WITH (security_invoker = true)
AS
SELECT
  id,
  name,
  'package_type'::text AS format_source,
  container_type,
  is_active
FROM package_types
WHERE container_type != 'keg'

UNION ALL

SELECT
  id,
  name,
  'keg_type'::text AS format_source,
  'keg'::text AS container_type,
  is_active
FROM keg_types;

COMMENT ON VIEW packaging_formats IS
  'Union view of non-keg package_types and keg_types for UI dropdowns. Use format_source to discriminate origin table.';

-- =============================================================================
-- 3. UPDATE DEPENDENT VIEWS
-- =============================================================================

-- Drop views in dependency order
DROP VIEW IF EXISTS finished_goods_supply_by_product;
DROP VIEW IF EXISTS finished_goods_with_availability;

-- Recreate finished_goods_with_availability with keg_type support
CREATE VIEW finished_goods_with_availability
WITH (security_invoker = true)
AS
SELECT
  fg.id,
  fg.batch_id,
  fg.brand_id,
  fg.package_type_id,
  fg.keg_type_id,
  fg.session_line_item_id,
  fg.quantity,
  fg.lot_number,
  fg.production_date,
  fg.best_by_date,
  fg.expiration_date,
  fg.notes,
  fg.version,
  fg.created_by,
  fg.created_at,
  fg.updated_at,
  b.name AS brand_name,
  COALESCE(pt.name, kt.name) AS package_type_name,
  CASE WHEN fg.keg_type_id IS NOT NULL THEN 'keg_type' ELSE 'package_type' END AS format_source,
  fg.quantity AS total_quantity,
  COALESCE(sum(
    CASE
      WHEN a.status = 'completed'::text THEN a.quantity
      ELSE 0::numeric
    END), 0::numeric) AS allocated_quantity,
  COALESCE(sum(
    CASE
      WHEN a.status = 'planned'::text THEN a.quantity
      ELSE 0::numeric
    END), 0::numeric) AS reserved_quantity,
  fg.quantity::numeric - COALESCE(sum(
    CASE
      WHEN a.status = ANY (ARRAY['planned'::text, 'completed'::text]) THEN a.quantity
      ELSE 0::numeric
    END), 0::numeric) AS available_quantity
FROM finished_goods fg
LEFT JOIN brands b ON b.id = fg.brand_id
LEFT JOIN package_types pt ON pt.id = fg.package_type_id
LEFT JOIN keg_types kt ON kt.id = fg.keg_type_id
LEFT JOIN allocations a ON a.source_type = 'finished_good'::text AND a.source_id = fg.id
GROUP BY fg.id, b.name, pt.name, kt.name;

-- Recreate finished_goods_supply_by_product with keg_type support
CREATE VIEW finished_goods_supply_by_product
WITH (security_invoker = true)
AS
SELECT
  fg.brand_id,
  fg.package_type_id,
  fg.keg_type_id,
  sum(fg.quantity)::integer AS total_quantity,
  sum(fga.available_quantity)::integer AS available_quantity,
  sum(fga.allocated_quantity)::integer AS allocated_quantity,
  sum(fga.reserved_quantity)::integer AS reserved_quantity
FROM finished_goods fg
JOIN finished_goods_with_availability fga ON fga.id = fg.id
WHERE fg.brand_id IS NOT NULL
  AND (fg.package_type_id IS NOT NULL OR fg.keg_type_id IS NOT NULL)
GROUP BY fg.brand_id, fg.package_type_id, fg.keg_type_id;

-- Update finished_goods_with_ttb_class to handle keg FGs
DROP VIEW IF EXISTS finished_goods_with_ttb_class;

CREATE VIEW finished_goods_with_ttb_class
WITH (security_invoker = true)
AS
SELECT
  fg.id,
  fg.batch_id,
  fg.brand_id,
  fg.package_type_id,
  fg.keg_type_id,
  fg.session_line_item_id,
  fg.quantity,
  fg.lot_number,
  fg.production_date,
  fg.best_by_date,
  fg.expiration_date,
  fg.notes,
  fg.version,
  fg.created_by,
  fg.created_at,
  fg.updated_at,
  COALESCE(pt.name, kt.name) AS package_type_name,
  COALESCE(pt.container_type, 'keg') AS container_type,
  COALESCE(pt.volume_oz, (kt.volume_bbl * 3968.0)::numeric(6,2)) AS volume_oz,
  pt.units_per_case,
  get_ttb_tax_class(COALESCE(pt.container_type, 'keg')) AS ttb_tax_class,
  (fg.quantity::numeric * COALESCE(pt.volume_oz, (kt.volume_bbl * 3968.0)::numeric(6,2)) / 3968.0)::numeric(10,4) AS volume_bbl,
  b.name AS brand_name
FROM finished_goods fg
LEFT JOIN package_types pt ON fg.package_type_id = pt.id
LEFT JOIN keg_types kt ON fg.keg_type_id = kt.id
JOIN brands b ON fg.brand_id = b.id;

-- Update order_demand_by_product to include keg items
DROP VIEW IF EXISTS order_demand_by_product;

CREATE VIEW order_demand_by_product
WITH (security_invoker = true)
AS
SELECT
  oi.brand_id,
  oi.package_type_id,
  oi.keg_type_id,
  date_trunc('week'::text, COALESCE(o.scheduled_date, o.requested_date)::timestamp with time zone)::date AS demand_week,
  sum(oi.quantity)::integer AS total_quantity,
  count(DISTINCT o.id)::integer AS order_count,
  min(COALESCE(o.scheduled_date, o.requested_date)) AS earliest_due_date,
  max(COALESCE(o.scheduled_date, o.requested_date)) AS latest_due_date,
  array_agg(DISTINCT o.id) AS order_ids,
  array_agg(DISTINCT o.status) AS order_statuses
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
WHERE (o.status <> ALL (ARRAY['fulfilled'::text, 'cancelled'::text]))
  AND oi.brand_id IS NOT NULL
  AND (oi.package_type_id IS NOT NULL OR oi.keg_type_id IS NOT NULL)
  AND COALESCE(o.scheduled_date, o.requested_date) IS NOT NULL
GROUP BY oi.brand_id, oi.package_type_id, oi.keg_type_id,
  (date_trunc('week'::text, COALESCE(o.scheduled_date, o.requested_date)::timestamp with time zone));

-- Update bin_contents to handle keg FGs
DROP VIEW IF EXISTS bin_contents;

CREATE VIEW bin_contents
WITH (security_invoker = true)
AS
SELECT
  bi.bin_id,
  'finished_good'::text AS item_type,
  fg.id AS item_id,
  b.name AS item_name,
  COALESCE(pt.name, kt.name) AS package_name,
  fg.lot_number,
  bi.quantity,
  fg.production_date AS item_date
FROM bin_inventory bi
JOIN finished_goods fg ON fg.id = bi.finished_good_id
JOIN brands b ON b.id = fg.brand_id
LEFT JOIN package_types pt ON pt.id = fg.package_type_id
LEFT JOIN keg_types kt ON kt.id = fg.keg_type_id
WHERE bi.quantity > 0

UNION ALL

SELECT
  bii.bin_id,
  'raw_material'::text AS item_type,
  il.id AS item_id,
  ii.name AS item_name,
  NULL::text AS package_name,
  il.lot_number,
  bii.quantity,
  il.received_date AS item_date
FROM bin_inventory_items bii
JOIN inventory_lots il ON il.id = bii.inventory_lot_id
JOIN inventory_items ii ON ii.id = il.inventory_item_id
WHERE bii.quantity > 0::numeric;

-- =============================================================================
-- 4. ORDER FULFILLMENT TRIGGER: Auto-create ship keg_transactions
-- =============================================================================

CREATE OR REPLACE FUNCTION create_keg_ship_transactions_from_order(p_order_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_item RECORD;
  v_count INTEGER := 0;
BEGIN
  SELECT id, customer_id, order_number INTO v_order
  FROM orders WHERE id = p_order_id;

  IF v_order IS NULL THEN
    RAISE EXCEPTION 'Order % not found', p_order_id;
  END IF;

  FOR v_item IN
    SELECT * FROM order_items
    WHERE order_id = p_order_id
      AND keg_type_id IS NOT NULL
      AND quantity > 0
  LOOP
    -- Idempotency: skip if ship transaction already exists for this order item
    IF EXISTS (
      SELECT 1 FROM keg_transactions
      WHERE order_id = p_order_id
        AND keg_type_id = v_item.keg_type_id
        AND transaction_type = 'ship'
        AND COALESCE(keg_owner_id, '00000000-0000-0000-0000-000000000000') =
            COALESCE(v_item.keg_owner_id, '00000000-0000-0000-0000-000000000000')
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO keg_transactions (
      transaction_type,
      keg_type_id,
      keg_owner_id,
      quantity,
      from_state,
      to_state,
      customer_id,
      order_id,
      notes
    ) VALUES (
      'ship',
      v_item.keg_type_id,
      v_item.keg_owner_id,
      v_item.quantity,
      'filled',
      'shipped',
      v_order.customer_id,
      v_order.id,
      'Auto-created from order ' || v_order.order_number || ' fulfillment'
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION create_keg_ship_transactions_from_order IS
  'Creates ship keg_transactions for all keg order items when an order is fulfilled.';

CREATE OR REPLACE FUNCTION trigger_order_fulfillment_keg_transactions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF NEW.status = 'fulfilled' AND (OLD.status IS NULL OR OLD.status != 'fulfilled') THEN
    v_count := create_keg_ship_transactions_from_order(NEW.id);
    IF v_count > 0 THEN
      RAISE NOTICE 'Created % keg ship transactions for order %', v_count, NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_order_fulfillment_keg_transactions ON orders;

CREATE TRIGGER on_order_fulfillment_keg_transactions
  AFTER UPDATE OF status ON orders
  FOR EACH ROW
  EXECUTE FUNCTION trigger_order_fulfillment_keg_transactions();

COMMENT ON TRIGGER on_order_fulfillment_keg_transactions ON orders IS
  'Auto-creates ship keg_transactions when an order is fulfilled.';

-- =============================================================================
-- 5. ENHANCE PACKAGING COMPLETION: Auto-create fill keg_transactions
-- =============================================================================

CREATE OR REPLACE FUNCTION create_finished_goods_from_packaging(p_session_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_session RECORD;
  v_line RECORD;
  v_batch_info JSONB;
  v_batch_id UUID;
  v_fg_id UUID;
  v_lot_number TEXT;
  v_count INTEGER := 0;
BEGIN
  SELECT * INTO v_session
  FROM packaging_sessions
  WHERE id = p_session_id;

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'Packaging session % not found', p_session_id;
  END IF;

  IF v_session.status != 'completed' THEN
    RAISE EXCEPTION 'Packaging session % is not completed (status: %)', p_session_id, v_session.status;
  END IF;

  FOR v_line IN
    SELECT * FROM session_line_items
    WHERE session_id = p_session_id
  LOOP
    IF v_line.actual_quantity IS NULL OR v_line.actual_quantity <= 0 THEN
      RAISE EXCEPTION 'Line item % has no actual quantity', v_line.id;
    END IF;

    -- Idempotency check
    IF EXISTS (SELECT 1 FROM finished_goods WHERE session_line_item_id = v_line.id) THEN
      CONTINUE;
    END IF;

    -- Extract batch_id from source_batches JSONB (use first batch)
    v_batch_info := v_line.source_batches->0;
    IF v_batch_info IS NOT NULL AND v_batch_info->>'batch_id' IS NOT NULL THEN
      v_batch_id := (v_batch_info->>'batch_id')::UUID;
    ELSE
      v_batch_id := NULL;
    END IF;

    v_lot_number := generate_lot_number(v_session.session_date);

    -- Create finished_goods record (now with keg_type_id support)
    INSERT INTO finished_goods (
      batch_id,
      brand_id,
      package_type_id,
      keg_type_id,
      session_line_item_id,
      quantity,
      lot_number,
      production_date,
      created_by
    ) VALUES (
      v_batch_id,
      v_line.brand_id,
      v_line.package_type_id,   -- NULL for keg lines
      v_line.keg_type_id,       -- NULL for non-keg lines
      v_line.id,
      v_line.actual_quantity,
      v_lot_number,
      v_session.session_date,
      v_session.created_by
    )
    RETURNING id INTO v_fg_id;

    -- Create allocation record (batch -> finished_good)
    IF v_batch_id IS NOT NULL THEN
      INSERT INTO allocations (
        source_type,
        source_id,
        destination_type,
        destination_id,
        quantity,
        status,
        lot_number,
        notes,
        completed_at,
        created_by
      ) VALUES (
        'batch',
        v_batch_id,
        'finished_good',
        v_fg_id,
        v_line.actual_quantity,
        'completed',
        v_lot_number,
        'Auto-created from packaging session ' || p_session_id::TEXT,
        NOW(),
        v_session.created_by
      );
    END IF;

    -- For keg lines, also create a fill keg_transaction
    IF v_line.keg_type_id IS NOT NULL THEN
      INSERT INTO keg_transactions (
        transaction_type,
        keg_type_id,
        keg_owner_id,
        quantity,
        from_state,
        to_state,
        packaging_session_id,
        batch_id,
        finished_good_id,
        notes
      ) VALUES (
        'fill',
        v_line.keg_type_id,
        v_line.keg_owner_id,
        v_line.actual_quantity,
        'empty',
        'filled',
        p_session_id,
        v_batch_id,
        v_fg_id,
        'Auto-created from packaging session completion'
      );
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- =============================================================================
-- 6. DEACTIVATE KEG ENTRIES IN package_types
-- =============================================================================

UPDATE package_types
SET is_active = false
WHERE container_type = 'keg';

-- =============================================================================
-- 7. SCHEMA REGISTRY
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships)
VALUES
  ('packaging_formats', 'Union view of non-keg package_types and keg_types for UI format selection', 'inventory',
   '[{"table": "package_types", "type": "union"}, {"table": "keg_types", "type": "union"}]'::jsonb),
  ('create_keg_ship_transactions_from_order', 'Creates ship keg_transactions when an order is fulfilled', 'sales',
   '[{"table": "keg_transactions", "type": "creates"}, {"table": "order_items", "type": "reads"}]'::jsonb)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships;
