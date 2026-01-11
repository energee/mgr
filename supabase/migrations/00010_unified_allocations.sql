-- Unified Allocations System Migration
-- Implements DEC-HP-001: Polymorphic allocations for all inventory movements
--
-- This migration creates the complete inventory tracking infrastructure:
-- - Purchasing: suppliers, POs, inventory lots
-- - Packaging: sessions, finished goods
-- - Inventory: bins, bin inventory, location transfers
-- - Unified allocations table with polymorphic source/destination

-- =============================================================================
-- PURCHASING DOMAIN
-- =============================================================================

-- Suppliers
CREATE TABLE suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  address JSONB,
  default_lead_time_days INTEGER,
  payment_terms TEXT,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE suppliers IS 'Ingredient and material suppliers.';

-- Supplier Catalog (what each supplier offers)
CREATE TABLE supplier_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  catalog_type TEXT NOT NULL,  -- malt, hop, yeast, adjunct, sugar, spice, fruit, additive
  catalog_id UUID NOT NULL,    -- FK to catalog item (polymorphic)
  supplier_sku TEXT,
  price DECIMAL(10,4),
  unit TEXT,
  min_order_qty DECIMAL(10,2),
  lead_time_days INTEGER,
  notes TEXT,
  is_preferred BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(supplier_id, catalog_type, catalog_id)
);

COMMENT ON TABLE supplier_catalog IS 'Links suppliers to catalog items with pricing.';

-- Purchase Orders
CREATE TABLE purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  po_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft',  -- draft, submitted, confirmed, partial, fulfilled, cancelled
  order_date DATE DEFAULT CURRENT_DATE,
  expected_date DATE,
  shipping_cost DECIMAL(10,2),
  tax DECIMAL(10,2),
  notes TEXT,
  submitted_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE purchase_orders IS 'Purchase orders to suppliers.';

CREATE INDEX idx_purchase_orders_status ON purchase_orders(status);
CREATE INDEX idx_purchase_orders_supplier ON purchase_orders(supplier_id);

-- PO Line Items
CREATE TABLE po_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  catalog_type TEXT NOT NULL,  -- malt, hop, yeast, etc.
  catalog_id UUID NOT NULL,
  quantity DECIMAL(10,4) NOT NULL,
  unit TEXT NOT NULL,
  unit_price DECIMAL(10,4),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE po_line_items IS 'Purchase order line items.';

CREATE INDEX idx_po_line_items_po ON po_line_items(po_id);

-- PO Receives (partial receives)
CREATE TABLE po_receives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_line_item_id UUID NOT NULL REFERENCES po_line_items(id) ON DELETE CASCADE,
  quantity DECIMAL(10,4) NOT NULL,
  lot_number TEXT,
  expiration_date DATE,
  received_date DATE DEFAULT CURRENT_DATE,
  received_by UUID REFERENCES auth.users(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE po_receives IS 'Partial receives against PO line items.';

CREATE INDEX idx_po_receives_line_item ON po_receives(po_line_item_id);

-- Inventory Lots (lot-level tracking for raw materials)
CREATE TABLE inventory_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  po_receive_id UUID REFERENCES po_receives(id) ON DELETE SET NULL,
  lot_number TEXT,
  quantity DECIMAL(10,4) NOT NULL,
  unit TEXT NOT NULL,
  unit_cost DECIMAL(10,4),
  landed_cost DECIMAL(10,4),
  received_date DATE DEFAULT CURRENT_DATE,
  expiration_date DATE,
  location TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE inventory_lots IS 'Lot-level inventory for raw materials. Quantity derived from allocations.';

CREATE INDEX idx_inventory_lots_item ON inventory_lots(inventory_item_id);
CREATE INDEX idx_inventory_lots_expiration ON inventory_lots(expiration_date) WHERE expiration_date IS NOT NULL;

-- =============================================================================
-- PACKAGING DOMAIN
-- =============================================================================

-- Packaging Sessions
CREATE TABLE packaging_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_date DATE DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'planned',  -- planned, in_progress, completed, revised, cancelled
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE packaging_sessions IS 'Packaging sessions grouping multiple products/batches.';

CREATE INDEX idx_packaging_sessions_status ON packaging_sessions(status);
CREATE INDEX idx_packaging_sessions_date ON packaging_sessions(session_date);

-- Session Line Items
CREATE TABLE session_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES packaging_sessions(id) ON DELETE CASCADE,
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE RESTRICT,
  package_type_id UUID NOT NULL REFERENCES package_types(id) ON DELETE RESTRICT,
  source_batches JSONB DEFAULT '[]',  -- [{batch_id, planned_qty, actual_qty}]
  planned_quantity INTEGER,
  actual_quantity INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE session_line_items IS 'Line items within a packaging session.';

CREATE INDEX idx_session_line_items_session ON session_line_items(session_id);

-- Finished Goods
CREATE TABLE finished_goods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID REFERENCES batches(id) ON DELETE SET NULL,
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE RESTRICT,
  package_type_id UUID NOT NULL REFERENCES package_types(id) ON DELETE RESTRICT,
  session_line_item_id UUID REFERENCES session_line_items(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL,
  lot_number TEXT NOT NULL,
  production_date DATE DEFAULT CURRENT_DATE,
  best_by_date DATE,
  expiration_date DATE,
  notes TEXT,
  version INTEGER DEFAULT 1,  -- optimistic locking
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  -- Either both batch_id and session_line_item_id are set (internal), or both are null (external)
  CONSTRAINT chk_fg_entry_point CHECK (
    (batch_id IS NOT NULL AND session_line_item_id IS NOT NULL) OR
    (batch_id IS NULL AND session_line_item_id IS NULL)
  )
);

COMMENT ON TABLE finished_goods IS 'Packaged products ready for sale. Tracks lot-level FG inventory.';

CREATE INDEX idx_finished_goods_batch ON finished_goods(batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX idx_finished_goods_brand ON finished_goods(brand_id);
CREATE INDEX idx_finished_goods_lot ON finished_goods(lot_number);
CREATE INDEX idx_finished_goods_expiration ON finished_goods(expiration_date) WHERE expiration_date IS NOT NULL;

-- =============================================================================
-- INVENTORY DOMAIN (Bins & Transfers)
-- =============================================================================

-- Bins (storage locations for finished goods)
CREATE TABLE bins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  bin_type TEXT NOT NULL DEFAULT 'storage',  -- storage, cold_room, staging, taproom, shipping, hold, quarantine
  capacity INTEGER,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(location_id, name)
);

COMMENT ON TABLE bins IS 'Storage bins/locations for finished goods.';

CREATE INDEX idx_bins_location ON bins(location_id);
CREATE INDEX idx_bins_type ON bins(bin_type);

-- Bin Inventory (FG quantities per bin - denormalized for fast lookups)
CREATE TABLE bin_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  finished_good_id UUID NOT NULL REFERENCES finished_goods(id) ON DELETE CASCADE,
  bin_id UUID NOT NULL REFERENCES bins(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(finished_good_id, bin_id)
);

COMMENT ON TABLE bin_inventory IS 'Finished goods quantities per bin. Denormalized for fast bin lookups.';

CREATE INDEX idx_bin_inventory_bin ON bin_inventory(bin_id);
CREATE INDEX idx_bin_inventory_fg ON bin_inventory(finished_good_id);

-- Location Transfers
CREATE TABLE location_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_bin_id UUID NOT NULL REFERENCES bins(id) ON DELETE RESTRICT,
  to_bin_id UUID NOT NULL REFERENCES bins(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'planned',  -- planned, in_transit, completed, cancelled
  ship_date DATE,
  receive_date DATE,
  shipped_by UUID REFERENCES auth.users(id),
  received_by UUID REFERENCES auth.users(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_different_bins CHECK (from_bin_id != to_bin_id)
);

COMMENT ON TABLE location_transfers IS 'Transfers of finished goods between bins/locations.';

CREATE INDEX idx_location_transfers_status ON location_transfers(status);
CREATE INDEX idx_location_transfers_from ON location_transfers(from_bin_id);
CREATE INDEX idx_location_transfers_to ON location_transfers(to_bin_id);

-- Transfer Lines
CREATE TABLE transfer_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id UUID NOT NULL REFERENCES location_transfers(id) ON DELETE CASCADE,
  finished_good_id UUID NOT NULL REFERENCES finished_goods(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE transfer_lines IS 'Line items for location transfers.';

CREATE INDEX idx_transfer_lines_transfer ON transfer_lines(transfer_id);

-- =============================================================================
-- UNIFIED ALLOCATIONS TABLE (restructure)
-- =============================================================================

-- First, rename old allocations table
ALTER TABLE allocations RENAME TO allocations_legacy;

-- Create new unified allocations table
CREATE TABLE allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Source (where inventory comes from)
  source_type TEXT NOT NULL,  -- inventory_lot, batch, finished_good, external
  source_id UUID,             -- FK to source record (null for external)
  -- Destination (where inventory goes)
  destination_type TEXT NOT NULL,  -- batch, finished_good, order, taproom_sale, sample, adjustment, destruction, loss, transfer
  destination_id UUID,        -- FK to destination record (null for sample/adjustment/destruction/loss)
  -- Quantities
  quantity DECIMAL(10,4) NOT NULL,  -- Always positive
  volume_bbl DECIMAL(10,4),         -- For TTB reporting
  unit_cost DECIMAL(10,4),
  -- Status
  status TEXT NOT NULL DEFAULT 'planned',  -- planned, pending_approval, completed, rejected, cancelled
  reason_code TEXT,           -- breakage, sample_customer, sample_quality, contamination, expired, spillage, theft
  lot_number TEXT,
  notes TEXT,
  -- Approval workflow
  requires_approval BOOLEAN DEFAULT false,
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  -- Timestamps
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  -- Constraints
  CONSTRAINT chk_allocation_quantity_positive CHECK (quantity >= 0),
  CONSTRAINT chk_allocation_volume_nonnegative CHECK (volume_bbl IS NULL OR volume_bbl >= 0),
  CONSTRAINT chk_allocation_status_valid CHECK (
    status IN ('planned', 'pending_approval', 'completed', 'rejected', 'cancelled')
  ),
  CONSTRAINT chk_allocation_source_type CHECK (
    source_type IN ('inventory_lot', 'batch', 'finished_good', 'external')
  ),
  CONSTRAINT chk_allocation_destination_type CHECK (
    destination_type IN ('batch', 'finished_good', 'order', 'taproom_sale', 'sample', 'adjustment', 'destruction', 'loss', 'transfer')
  ),
  CONSTRAINT chk_allocation_approval_consistency CHECK (
    (requires_approval = false) OR
    (status != 'completed' OR approved_by IS NOT NULL)
  )
);

COMMENT ON TABLE allocations IS 'Unified allocation table for all inventory movements. Single audit trail across raw materials, batches, and finished goods.';

-- Comprehensive indexes for allocation queries
CREATE INDEX idx_allocations_source ON allocations(source_type, source_id, status);
CREATE INDEX idx_allocations_destination ON allocations(destination_type, destination_id, status);
CREATE INDEX idx_allocations_status_date ON allocations(status, created_at DESC);
CREATE INDEX idx_allocations_src_dest_status ON allocations(source_type, destination_type, status);
CREATE INDEX idx_allocations_dest_created ON allocations(destination_type, created_at);
CREATE INDEX idx_allocations_pending_approval ON allocations(status) WHERE status = 'pending_approval';

-- Migrate existing allocation data
-- Note: Legacy allocations only tracked raw material movements (inventory_item_id based)
-- We need to convert them to the new source/destination model

-- For receipts: source_type='external', destination needs an inventory_lot
-- For batch_usage: source_type='inventory_lot' (need to find/create lot), destination_type='batch'
-- For adjustments: handled as special cases

-- Since we don't have inventory_lots for existing data, we'll create them from receipt allocations
INSERT INTO inventory_lots (inventory_item_id, lot_number, quantity, unit, unit_cost, received_date, notes)
SELECT
  al.inventory_item_id,
  COALESCE(al.lot_number, 'LEGACY-' || al.id::text),
  al.quantity,
  ii.unit,
  al.unit_cost,
  COALESCE(al.created_at::date, CURRENT_DATE),
  'Migrated from legacy allocation: ' || al.id::text
FROM allocations_legacy al
JOIN inventory_items ii ON ii.id = al.inventory_item_id
WHERE al.allocation_type = 'receipt'
  AND al.quantity > 0;

-- Migrate receipt allocations (external → new lot creates the lot, tracked via external source)
INSERT INTO allocations (source_type, source_id, destination_type, destination_id, quantity, unit_cost, status, lot_number, notes, created_by, created_at)
SELECT
  'external',
  NULL,
  'batch',  -- Simplified: receipts into general inventory, represented as going to a virtual "stock" destination
  NULL,     -- No specific destination
  al.quantity,
  al.unit_cost,
  'completed',
  al.lot_number,
  'Migrated receipt: ' || COALESCE(al.notes, ''),
  al.created_by,
  al.created_at
FROM allocations_legacy al
WHERE al.allocation_type = 'receipt'
  AND al.quantity > 0;

-- Migrate batch usage allocations
INSERT INTO allocations (source_type, source_id, destination_type, destination_id, quantity, status, lot_number, notes, created_by, created_at)
SELECT
  'inventory_lot',
  il.id,  -- Link to the inventory lot we created
  'batch',
  al.reference_id,
  ABS(al.quantity),  -- Convert negative to positive
  'completed',
  al.lot_number,
  'Migrated batch usage: ' || COALESCE(al.notes, ''),
  al.created_by,
  al.created_at
FROM allocations_legacy al
JOIN inventory_lots il ON il.inventory_item_id = al.inventory_item_id
  AND il.lot_number = COALESCE(al.lot_number, 'LEGACY-' || (
    SELECT id FROM allocations_legacy al2
    WHERE al2.inventory_item_id = al.inventory_item_id
      AND al2.allocation_type = 'receipt'
    ORDER BY al2.created_at
    LIMIT 1
  )::text)
WHERE al.allocation_type = 'batch_usage'
  AND al.quantity < 0;

-- Migrate adjustments
INSERT INTO allocations (source_type, source_id, destination_type, destination_id, quantity, status, reason_code, notes, created_by, created_at)
SELECT
  CASE WHEN al.quantity > 0 THEN 'external' ELSE 'inventory_lot' END,
  CASE WHEN al.quantity > 0 THEN NULL ELSE il.id END,
  'adjustment',
  NULL,
  ABS(al.quantity),
  'completed',
  'legacy_adjustment',
  'Migrated adjustment: ' || COALESCE(al.notes, ''),
  al.created_by,
  al.created_at
FROM allocations_legacy al
LEFT JOIN inventory_lots il ON il.inventory_item_id = al.inventory_item_id
WHERE al.allocation_type = 'adjustment';

-- Drop legacy table (keep commented for safety, uncomment after verification)
-- DROP TABLE allocations_legacy;

-- =============================================================================
-- VIEWS
-- =============================================================================

-- PO Line Items with quantities
CREATE VIEW po_line_items_with_quantities AS
SELECT
  pli.*,
  pli.quantity as ordered_quantity,
  COALESCE(SUM(por.quantity), 0) as received_quantity,
  pli.quantity - COALESCE(SUM(por.quantity), 0) as outstanding_quantity
FROM po_line_items pli
LEFT JOIN po_receives por ON por.po_line_item_id = pli.id
GROUP BY pli.id;

-- Inventory Lots with quantities
CREATE VIEW inventory_lots_with_quantities AS
SELECT
  il.*,
  il.quantity as received_quantity,
  COALESCE(SUM(CASE WHEN a.status IN ('planned', 'completed')
    THEN a.quantity ELSE 0 END), 0) as allocated_quantity,
  il.quantity - COALESCE(SUM(CASE WHEN a.status IN ('planned', 'completed')
    THEN a.quantity ELSE 0 END), 0) as remaining_quantity
FROM inventory_lots il
LEFT JOIN allocations a
  ON a.source_type = 'inventory_lot' AND a.source_id = il.id
GROUP BY il.id;

-- Finished Goods with availability
CREATE VIEW finished_goods_with_availability AS
SELECT
  fg.*,
  fg.quantity as total_quantity,
  COALESCE(SUM(CASE WHEN a.status = 'completed'
    THEN a.quantity ELSE 0 END), 0) as allocated_quantity,
  COALESCE(SUM(CASE WHEN a.status = 'planned'
    THEN a.quantity ELSE 0 END), 0) as reserved_quantity,
  fg.quantity - COALESCE(SUM(CASE WHEN a.status IN ('planned', 'completed')
    THEN a.quantity ELSE 0 END), 0) as available_quantity
FROM finished_goods fg
LEFT JOIN allocations a
  ON a.source_type = 'finished_good' AND a.source_id = fg.id
GROUP BY fg.id;

-- Batch volume remaining
CREATE VIEW batches_with_remaining_volume AS
SELECT
  b.*,
  b.volume_bbl as total_volume_bbl,
  COALESCE(SUM(CASE WHEN a.status = 'completed' THEN a.volume_bbl ELSE 0 END), 0) as packaged_volume_bbl,
  b.volume_bbl - COALESCE(SUM(CASE WHEN a.status = 'completed' THEN a.volume_bbl ELSE 0 END), 0) as remaining_volume_bbl
FROM batches b
LEFT JOIN allocations a ON a.source_type = 'batch' AND a.source_id = b.id
GROUP BY b.id;

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE po_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE po_receives ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE packaging_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE finished_goods ENABLE ROW LEVEL SECURITY;
ALTER TABLE bins ENABLE ROW LEVEL SECURITY;
ALTER TABLE bin_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfer_lines ENABLE ROW LEVEL SECURITY;

-- For single-tenant mode, allow all authenticated users
CREATE POLICY suppliers_access ON suppliers FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY supplier_catalog_access ON supplier_catalog FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY purchase_orders_access ON purchase_orders FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY po_line_items_access ON po_line_items FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY po_receives_access ON po_receives FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY inventory_lots_access ON inventory_lots FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY packaging_sessions_access ON packaging_sessions FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY session_line_items_access ON session_line_items FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY finished_goods_access ON finished_goods FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY bins_access ON bins FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY bin_inventory_access ON bin_inventory FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY location_transfers_access ON location_transfers FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY transfer_lines_access ON transfer_lines FOR ALL USING (auth.uid() IS NOT NULL);

-- Re-enable RLS on new allocations table
ALTER TABLE allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY allocations_access ON allocations FOR ALL USING (auth.uid() IS NOT NULL);

-- =============================================================================
-- UPDATED_AT TRIGGERS
-- =============================================================================

CREATE TRIGGER update_suppliers_updated_at BEFORE UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_supplier_catalog_updated_at BEFORE UPDATE ON supplier_catalog
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_purchase_orders_updated_at BEFORE UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_inventory_lots_updated_at BEFORE UPDATE ON inventory_lots
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_packaging_sessions_updated_at BEFORE UPDATE ON packaging_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_finished_goods_updated_at BEFORE UPDATE ON finished_goods
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_bins_updated_at BEFORE UPDATE ON bins
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_bin_inventory_updated_at BEFORE UPDATE ON bin_inventory
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_location_transfers_updated_at BEFORE UPDATE ON location_transfers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_allocations_updated_at BEFORE UPDATE ON allocations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================================================
-- SCHEMA REGISTRY
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields, state_machine, query_examples) VALUES
('suppliers', 'Ingredient and material suppliers.', 'purchasing',
 '["has_many: supplier_catalog", "has_many: purchase_orders"]',
 '["name", "contact_email"]', NULL,
 '["List active suppliers", "Find supplier by name"]'),

('supplier_catalog', 'Links suppliers to catalog items with pricing.', 'purchasing',
 '["belongs_to: suppliers"]',
 '["supplier_id", "catalog_type", "catalog_id", "price"]', NULL,
 '["Find suppliers for a hop", "Get preferred supplier for malt"]'),

('purchase_orders', 'Purchase orders to suppliers.', 'purchasing',
 '["belongs_to: suppliers", "has_many: po_line_items"]',
 '["po_number", "status", "supplier_id"]',
 '{"stateField": "status", "states": ["draft", "submitted", "confirmed", "partial", "fulfilled", "cancelled"], "transitions": {"draft": ["submitted", "cancelled"], "submitted": ["confirmed", "cancelled"], "confirmed": ["partial", "fulfilled", "cancelled"], "partial": ["fulfilled", "cancelled"]}}',
 '["List open POs", "Get POs for supplier", "Find POs awaiting delivery"]'),

('po_line_items', 'Purchase order line items.', 'purchasing',
 '["belongs_to: purchase_orders", "has_many: po_receives"]',
 '["catalog_type", "catalog_id", "quantity"]', NULL,
 '["Get line items for PO", "Find outstanding items"]'),

('po_receives', 'Partial receives against PO line items.', 'purchasing',
 '["belongs_to: po_line_items"]',
 '["quantity", "lot_number", "received_date"]', NULL,
 '["Get receives for PO line", "Find recent receives"]'),

('inventory_lots', 'Lot-level inventory for raw materials. FIFO costing.', 'inventory',
 '["belongs_to: inventory_items", "belongs_to: po_receives"]',
 '["lot_number", "quantity", "expiration_date"]', NULL,
 '["Get available lots for item (FIFO)", "Find expiring lots", "Calculate COGS for batch"]'),

('packaging_sessions', 'Packaging sessions grouping products/batches.', 'packaging',
 '["has_many: session_line_items"]',
 '["session_date", "status"]',
 '{"stateField": "status", "states": ["planned", "in_progress", "completed", "revised", "cancelled"], "transitions": {"planned": ["in_progress", "cancelled"], "in_progress": ["completed", "cancelled"], "completed": ["revised"]}}',
 '["List sessions this week", "Get in-progress sessions"]'),

('session_line_items', 'Line items within a packaging session.', 'packaging',
 '["belongs_to: packaging_sessions", "belongs_to: brands", "belongs_to: package_types"]',
 '["brand_id", "package_type_id", "actual_quantity"]', NULL,
 '["Get line items for session", "Find packaging by brand"]'),

('finished_goods', 'Packaged products ready for sale.', 'packaging',
 '["belongs_to: batches", "belongs_to: brands", "belongs_to: package_types", "belongs_to: session_line_items"]',
 '["lot_number", "quantity", "brand_id", "package_type_id"]', NULL,
 '["Get available FG for brand", "Find FG by lot number", "List expiring products"]'),

('bins', 'Storage bins/locations for finished goods.', 'inventory',
 '["belongs_to: locations", "has_many: bin_inventory"]',
 '["name", "bin_type", "location_id"]', NULL,
 '["List bins at location", "Find cold room bins", "Get staging bins"]'),

('bin_inventory', 'Finished goods quantities per bin.', 'inventory',
 '["belongs_to: finished_goods", "belongs_to: bins"]',
 '["finished_good_id", "bin_id", "quantity"]', NULL,
 '["Get inventory in bin", "Find where FG is stored"]'),

('location_transfers', 'Transfers of finished goods between bins.', 'inventory',
 '["belongs_to: bins (from)", "belongs_to: bins (to)", "has_many: transfer_lines"]',
 '["status", "from_bin_id", "to_bin_id"]',
 '{"stateField": "status", "states": ["planned", "in_transit", "completed", "cancelled"], "transitions": {"planned": ["in_transit", "cancelled"], "in_transit": ["completed", "cancelled"]}}',
 '["List in-transit transfers", "Get transfers for bin"]'),

('transfer_lines', 'Line items for location transfers.', 'inventory',
 '["belongs_to: location_transfers", "belongs_to: finished_goods"]',
 '["finished_good_id", "quantity"]', NULL,
 '["Get lines for transfer"]')
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships,
  key_fields = EXCLUDED.key_fields,
  state_machine = EXCLUDED.state_machine,
  query_examples = EXCLUDED.query_examples,
  updated_at = NOW();

-- Update allocations registry entry
UPDATE _schema_registry SET
  description = 'Unified allocation table for all inventory movements. Polymorphic source/destination.',
  relationships = '["belongs_to: inventory_lots (source)", "belongs_to: batches (source/dest)", "belongs_to: finished_goods (source/dest)", "belongs_to: orders (dest)"]'::jsonb,
  key_fields = '["source_type", "source_id", "destination_type", "destination_id", "status", "quantity"]'::jsonb,
  query_examples = '["Get allocations for FG (availability)", "Calculate TTB line items", "Find pending approvals", "Audit trail for batch"]'::jsonb,
  updated_at = NOW()
WHERE table_name = 'allocations';

-- =============================================================================
-- ADD package_types columns for inner packs (if not exists)
-- =============================================================================

ALTER TABLE package_types ADD COLUMN IF NOT EXISTS inner_pack_size INTEGER;
ALTER TABLE package_types ADD COLUMN IF NOT EXISTS inner_packs_per_case INTEGER;

-- Add constraint for inner pack consistency
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_package_units_consistency'
  ) THEN
    ALTER TABLE package_types ADD CONSTRAINT chk_package_units_consistency CHECK (
      (inner_pack_size IS NULL AND inner_packs_per_case IS NULL) OR
      (inner_pack_size IS NOT NULL AND inner_packs_per_case IS NOT NULL
       AND units_per_case = inner_pack_size * inner_packs_per_case)
    );
  END IF;
END $$;

SELECT 'Unified allocations migration complete!' AS message;
