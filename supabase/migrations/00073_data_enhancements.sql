-- =============================================================================
-- Data Enhancements: Bins for raw materials, deliveries, transfer improvements
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. bin_inventory_items: Raw material quantities per bin
--    Mirrors bin_inventory (which tracks finished goods) for inventory_lots
-- -----------------------------------------------------------------------------

CREATE TABLE bin_inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_lot_id UUID NOT NULL REFERENCES inventory_lots(id) ON DELETE CASCADE,
  bin_id UUID NOT NULL REFERENCES bins(id) ON DELETE CASCADE,
  quantity NUMERIC NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(inventory_lot_id, bin_id)
);

COMMENT ON TABLE bin_inventory_items IS 'Tracks raw material (inventory lot) quantities stored in each bin.';

CREATE INDEX idx_bin_inventory_items_lot ON bin_inventory_items(inventory_lot_id);
CREATE INDEX idx_bin_inventory_items_bin ON bin_inventory_items(bin_id);

-- -----------------------------------------------------------------------------
-- 2. deliveries: Groups transfers + orders into delivery runs
-- -----------------------------------------------------------------------------

CREATE TABLE deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'in_transit', 'completed', 'cancelled')),
  scheduled_date DATE,
  ship_date TIMESTAMPTZ,
  receive_date TIMESTAMPTZ,
  driver_name TEXT,
  vehicle TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE deliveries IS 'Groups location transfers and order fulfillments into a single delivery run.';

CREATE INDEX idx_deliveries_status ON deliveries(status);
CREATE INDEX idx_deliveries_scheduled ON deliveries(scheduled_date);

-- Auto-generate delivery numbers: DEL-YYYYMMDD-NNN
CREATE OR REPLACE FUNCTION generate_delivery_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_date TEXT;
  v_seq INTEGER;
BEGIN
  v_date := TO_CHAR(COALESCE(NEW.scheduled_date, CURRENT_DATE), 'YYYYMMDD');
  SELECT COALESCE(MAX(
    CAST(SUBSTRING(delivery_number FROM 'DEL-' || v_date || '-(\d+)') AS INTEGER)
  ), 0) + 1
  INTO v_seq
  FROM deliveries
  WHERE delivery_number LIKE 'DEL-' || v_date || '-%';

  NEW.delivery_number := 'DEL-' || v_date || '-' || LPAD(v_seq::TEXT, 3, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_delivery_number
  BEFORE INSERT ON deliveries
  FOR EACH ROW
  WHEN (NEW.delivery_number IS NULL OR NEW.delivery_number = '')
  EXECUTE FUNCTION generate_delivery_number();

-- -----------------------------------------------------------------------------
-- 3. Add delivery_id to location_transfers and orders
-- -----------------------------------------------------------------------------

ALTER TABLE location_transfers
ADD COLUMN delivery_id UUID REFERENCES deliveries(id) ON DELETE SET NULL;

CREATE INDEX idx_location_transfers_delivery ON location_transfers(delivery_id);

ALTER TABLE orders
ADD COLUMN delivery_id UUID REFERENCES deliveries(id) ON DELETE SET NULL;

CREATE INDEX idx_orders_delivery ON orders(delivery_id);

-- -----------------------------------------------------------------------------
-- 4. Extend transfer_lines for raw materials
--    Currently finished_good_id is NOT NULL; make it nullable, add inventory_lot_id
-- -----------------------------------------------------------------------------

ALTER TABLE transfer_lines
ALTER COLUMN finished_good_id DROP NOT NULL;

ALTER TABLE transfer_lines
ADD COLUMN inventory_lot_id UUID REFERENCES inventory_lots(id) ON DELETE CASCADE;

ALTER TABLE transfer_lines
ADD CONSTRAINT transfer_lines_item_xor
CHECK (
  (finished_good_id IS NOT NULL AND inventory_lot_id IS NULL) OR
  (finished_good_id IS NULL AND inventory_lot_id IS NOT NULL)
);

CREATE INDEX idx_transfer_lines_lot ON transfer_lines(inventory_lot_id);

-- -----------------------------------------------------------------------------
-- 5. Views
-- -----------------------------------------------------------------------------

-- bin_contents: Union of FG and raw materials per bin
CREATE VIEW bin_contents
WITH (security_invoker = true)
AS
SELECT
  bi.bin_id,
  'finished_good'::TEXT AS item_type,
  fg.id AS item_id,
  b.name AS item_name,
  pt.name AS package_name,
  fg.lot_number,
  bi.quantity,
  fg.production_date AS item_date
FROM bin_inventory bi
JOIN finished_goods fg ON fg.id = bi.finished_good_id
JOIN brands b ON b.id = fg.brand_id
JOIN package_types pt ON pt.id = fg.package_type_id
WHERE bi.quantity > 0

UNION ALL

SELECT
  bii.bin_id,
  'raw_material'::TEXT AS item_type,
  il.id AS item_id,
  ii.name AS item_name,
  NULL AS package_name,
  il.lot_number,
  bii.quantity,
  il.received_date AS item_date
FROM bin_inventory_items bii
JOIN inventory_lots il ON il.id = bii.inventory_lot_id
JOIN inventory_items ii ON ii.id = il.inventory_item_id
WHERE bii.quantity > 0;

COMMENT ON VIEW bin_contents IS 'Unified view of all items (FG and raw materials) stored in bins.';

-- deliveries_with_summary: Delivery with stop counts
CREATE VIEW deliveries_with_summary
WITH (security_invoker = true)
AS
SELECT
  d.*,
  COALESCE(lt_counts.transfer_count, 0) AS transfer_count,
  COALESCE(o_counts.order_count, 0) AS order_count,
  COALESCE(lt_counts.transfer_count, 0) + COALESCE(o_counts.order_count, 0) AS total_stops
FROM deliveries d
LEFT JOIN (
  SELECT delivery_id, COUNT(*) AS transfer_count
  FROM location_transfers
  WHERE delivery_id IS NOT NULL
  GROUP BY delivery_id
) lt_counts ON lt_counts.delivery_id = d.id
LEFT JOIN (
  SELECT delivery_id, COUNT(*) AS order_count
  FROM orders
  WHERE delivery_id IS NOT NULL
  GROUP BY delivery_id
) o_counts ON o_counts.delivery_id = d.id;

COMMENT ON VIEW deliveries_with_summary IS 'Deliveries with counts of associated transfers and orders.';

-- location_transfers view for list display
CREATE VIEW location_transfers_with_details
WITH (security_invoker = true)
AS
SELECT
  lt.*,
  fb.name AS from_bin_name,
  fl.name AS from_location_name,
  tb.name AS to_bin_name,
  tl.name AS to_location_name,
  d.delivery_number,
  (SELECT COUNT(*) FROM transfer_lines tl2 WHERE tl2.transfer_id = lt.id) AS lines_count
FROM location_transfers lt
JOIN bins fb ON fb.id = lt.from_bin_id
JOIN locations fl ON fl.id = fb.location_id
JOIN bins tb ON tb.id = lt.to_bin_id
JOIN locations tl ON tl.id = tb.location_id
LEFT JOIN deliveries d ON d.id = lt.delivery_id;

COMMENT ON VIEW location_transfers_with_details IS 'Location transfers with bin/location names and line counts.';

-- bins_with_summary: Bin with item counts
CREATE VIEW bins_with_summary
WITH (security_invoker = true)
AS
SELECT
  b.*,
  l.name AS location_name,
  l.location_type,
  COALESCE(fg_counts.fg_count, 0) AS fg_item_count,
  COALESCE(rm_counts.rm_count, 0) AS rm_item_count,
  COALESCE(fg_counts.fg_count, 0) + COALESCE(rm_counts.rm_count, 0) AS total_item_count
FROM bins b
JOIN locations l ON l.id = b.location_id
LEFT JOIN (
  SELECT bin_id, COUNT(*) AS fg_count
  FROM bin_inventory
  WHERE quantity > 0
  GROUP BY bin_id
) fg_counts ON fg_counts.bin_id = b.id
LEFT JOIN (
  SELECT bin_id, COUNT(*) AS rm_count
  FROM bin_inventory_items
  WHERE quantity > 0
  GROUP BY bin_id
) rm_counts ON rm_counts.bin_id = b.id;

COMMENT ON VIEW bins_with_summary IS 'Bins with location info and item counts.';

-- -----------------------------------------------------------------------------
-- 6. RLS Policies
-- -----------------------------------------------------------------------------

ALTER TABLE bin_inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY bin_inventory_items_access ON bin_inventory_items
  FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY deliveries_access ON deliveries
  FOR ALL USING (auth.uid() IS NOT NULL);

-- -----------------------------------------------------------------------------
-- 7. Schema Registry
-- -----------------------------------------------------------------------------

INSERT INTO _schema_registry (
  table_name, description, domain, relationships, key_fields, state_machine, query_examples
) VALUES
('bin_inventory_items', 'Tracks raw material (inventory lot) quantities stored in each bin.', 'inventory',
 '["belongs_to: inventory_lots", "belongs_to: bins"]',
 '["inventory_lot_id", "bin_id", "quantity"]',
 NULL,
 '["Get raw materials in bin", "Find where lot is stored"]'),

('deliveries', 'Groups location transfers and order fulfillments into a single delivery run.', 'inventory',
 '["has_many: location_transfers", "has_many: orders"]',
 '["delivery_number", "status", "scheduled_date", "driver_name"]',
 '{"stateField": "status", "states": ["planned", "in_transit", "completed", "cancelled"], "transitions": {"planned": ["in_transit", "cancelled"], "in_transit": ["completed", "cancelled"]}}',
 '["List planned deliveries", "Get deliveries for date", "Find in-transit deliveries"]')

ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships,
  key_fields = EXCLUDED.key_fields,
  state_machine = EXCLUDED.state_machine,
  query_examples = EXCLUDED.query_examples,
  updated_at = NOW();

-- Update transfer_lines registry to include inventory_lot support
UPDATE _schema_registry
SET relationships = '["belongs_to: location_transfers", "belongs_to: finished_goods", "belongs_to: inventory_lots"]',
    key_fields = '["finished_good_id", "inventory_lot_id", "quantity"]',
    updated_at = NOW()
WHERE table_name = 'transfer_lines';

-- Update location_transfers registry to include delivery reference
UPDATE _schema_registry
SET relationships = '["belongs_to: bins (from)", "belongs_to: bins (to)", "has_many: transfer_lines", "belongs_to: deliveries"]',
    key_fields = '["status", "from_bin_id", "to_bin_id", "delivery_id"]',
    updated_at = NOW()
WHERE table_name = 'location_transfers';
