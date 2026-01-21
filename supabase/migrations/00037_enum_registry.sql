-- Migration: 00037_enum_registry.sql
-- Purpose: Create centralized enum registry for dynamic enum management
-- Phase: 5.3 Enum Registry
--
-- Per IMPLEMENTATION-PLAN.md: Centralize all hardcoded enums into a queryable table
-- to enable dynamic management and AI integration.

-- =============================================================================
-- 1. Create enum_values table
-- =============================================================================

CREATE TABLE enum_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Enum identification
  enum_type TEXT NOT NULL,      -- e.g., 'batch_status', 'vessel_type'
  value TEXT NOT NULL,          -- The actual enum value

  -- Display information
  label TEXT NOT NULL,          -- Human-readable label
  description TEXT,             -- Optional description
  color TEXT,                   -- Color for UI display (matches StatusBadge colors)
  icon TEXT,                    -- Optional icon name (lucide-react)

  -- Ordering and grouping
  sort_order INTEGER NOT NULL DEFAULT 0,
  group_name TEXT,              -- Optional grouping within enum type

  -- Metadata
  is_default BOOLEAN DEFAULT FALSE,  -- Is this the default value for new records?
  is_active BOOLEAN DEFAULT TRUE,    -- Can be deactivated without deletion
  metadata JSONB DEFAULT '{}'::jsonb, -- Additional type-specific metadata

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Ensure unique enum type + value combinations
  CONSTRAINT uq_enum_type_value UNIQUE (enum_type, value)
);

-- Indexes for efficient lookups
CREATE INDEX idx_enum_values_type ON enum_values(enum_type);
CREATE INDEX idx_enum_values_type_active ON enum_values(enum_type) WHERE is_active = TRUE;
CREATE INDEX idx_enum_values_type_sort ON enum_values(enum_type, sort_order);

-- Comments
COMMENT ON TABLE enum_values IS 'Centralized registry for all enum values in the system. Enables dynamic enum management and AI integration.';
COMMENT ON COLUMN enum_values.enum_type IS 'The enum category (e.g., batch_status, vessel_type)';
COMMENT ON COLUMN enum_values.value IS 'The actual value stored in database columns';
COMMENT ON COLUMN enum_values.label IS 'Human-readable display label';
COMMENT ON COLUMN enum_values.color IS 'UI color: success, warning, error, info, default';
COMMENT ON COLUMN enum_values.metadata IS 'Additional type-specific data (e.g., state machine transitions)';

-- =============================================================================
-- 2. Seed enum values from codebase
-- =============================================================================

-- Batch Status (state machine)
INSERT INTO enum_values (enum_type, value, label, description, color, sort_order, is_default, metadata) VALUES
  ('batch_status', 'planned', 'Planned', 'Batch is scheduled but not started', 'default', 10, TRUE, '{"next_states": ["brewing"]}'::jsonb),
  ('batch_status', 'brewing', 'Brewing', 'Currently in brew day', 'info', 20, FALSE, '{"next_states": ["fermenting", "cancelled"]}'::jsonb),
  ('batch_status', 'fermenting', 'Fermenting', 'In primary or secondary fermentation', 'warning', 30, FALSE, '{"next_states": ["conditioning", "cancelled"]}'::jsonb),
  ('batch_status', 'conditioning', 'Conditioning', 'Conditioning/lagering phase', 'warning', 40, FALSE, '{"next_states": ["ready", "cancelled"]}'::jsonb),
  ('batch_status', 'ready', 'Ready', 'Ready for packaging', 'success', 50, FALSE, '{"next_states": ["packaging", "cancelled"]}'::jsonb),
  ('batch_status', 'packaging', 'Packaging', 'Being packaged', 'info', 60, FALSE, '{"next_states": ["completed", "cancelled"]}'::jsonb),
  ('batch_status', 'completed', 'Completed', 'Batch is complete', 'success', 70, FALSE, '{"next_states": []}'::jsonb),
  ('batch_status', 'cancelled', 'Cancelled', 'Batch was cancelled', 'error', 80, FALSE, '{"next_states": []}'::jsonb);

-- Order Status (state machine)
INSERT INTO enum_values (enum_type, value, label, description, color, sort_order, is_default, metadata) VALUES
  ('order_status', 'draft', 'Draft', 'Order being prepared', 'default', 10, TRUE, '{"next_states": ["confirmed"]}'::jsonb),
  ('order_status', 'confirmed', 'Confirmed', 'Order confirmed with customer', 'info', 20, FALSE, '{"next_states": ["picking", "cancelled"]}'::jsonb),
  ('order_status', 'picking', 'Picking', 'Order being picked/prepared', 'warning', 30, FALSE, '{"next_states": ["ready", "cancelled"]}'::jsonb),
  ('order_status', 'ready', 'Ready', 'Ready for delivery/pickup', 'success', 40, FALSE, '{"next_states": ["delivered", "cancelled"]}'::jsonb),
  ('order_status', 'delivered', 'Delivered', 'Order delivered to customer', 'success', 50, FALSE, '{"next_states": ["invoiced"]}'::jsonb),
  ('order_status', 'invoiced', 'Invoiced', 'Invoice sent to customer', 'info', 60, FALSE, '{"next_states": ["paid"]}'::jsonb),
  ('order_status', 'paid', 'Paid', 'Payment received', 'success', 70, FALSE, '{"next_states": []}'::jsonb),
  ('order_status', 'cancelled', 'Cancelled', 'Order was cancelled', 'error', 80, FALSE, '{"next_states": []}'::jsonb);

-- Purchase Order Status (matches purchase-order.tsx state machine)
INSERT INTO enum_values (enum_type, value, label, description, color, sort_order, is_default, metadata) VALUES
  ('po_status', 'draft', 'Draft', 'PO being prepared', 'default', 10, TRUE, '{"next_states": ["submitted", "cancelled"]}'::jsonb),
  ('po_status', 'submitted', 'Submitted', 'Sent to supplier', 'info', 20, FALSE, '{"next_states": ["confirmed", "cancelled"]}'::jsonb),
  ('po_status', 'confirmed', 'Confirmed', 'Supplier confirmed', 'info', 30, FALSE, '{"next_states": ["partial", "fulfilled", "cancelled"]}'::jsonb),
  ('po_status', 'partial', 'Partial', 'Partially received', 'warning', 40, FALSE, '{"next_states": ["fulfilled", "cancelled"]}'::jsonb),
  ('po_status', 'fulfilled', 'Fulfilled', 'Fully received', 'success', 50, FALSE, '{"next_states": ["closed"]}'::jsonb),
  ('po_status', 'cancelled', 'Cancelled', 'PO was cancelled', 'error', 60, FALSE, '{"next_states": []}'::jsonb),
  ('po_status', 'closed', 'Closed', 'PO completed and closed', 'default', 70, FALSE, '{"next_states": []}'::jsonb);

-- Vessel Status
INSERT INTO enum_values (enum_type, value, label, description, color, sort_order, is_default, metadata) VALUES
  ('vessel_status', 'available', 'Available', 'Ready for use', 'success', 10, TRUE, NULL),
  ('vessel_status', 'in_use', 'In Use', 'Currently occupied', 'warning', 20, FALSE, NULL),
  ('vessel_status', 'cleaning', 'Cleaning', 'Being cleaned/sanitized', 'info', 30, FALSE, NULL),
  ('vessel_status', 'maintenance', 'Maintenance', 'Under maintenance', 'error', 40, FALSE, NULL),
  ('vessel_status', 'out_of_service', 'Out of Service', 'Not available', 'default', 50, FALSE, NULL);

-- Vessel Type
INSERT INTO enum_values (enum_type, value, label, description, color, sort_order, metadata) VALUES
  ('vessel_type', 'fermenter', 'Fermenter', 'Primary/secondary fermentation vessel', NULL, 10, '{"typical_uses": ["fermentation", "conditioning"]}'::jsonb),
  ('vessel_type', 'brite', 'Brite Tank', 'Bright/conditioning tank', NULL, 20, '{"typical_uses": ["conditioning", "carbonation"]}'::jsonb),
  ('vessel_type', 'kettle', 'Kettle', 'Brew kettle', NULL, 30, '{"typical_uses": ["brewing"]}'::jsonb),
  ('vessel_type', 'mash_tun', 'Mash Tun', 'Mashing vessel', NULL, 40, '{"typical_uses": ["mashing"]}'::jsonb),
  ('vessel_type', 'hot_liquor', 'Hot Liquor Tank', 'Hot water storage', NULL, 50, '{"typical_uses": ["water_heating"]}'::jsonb),
  ('vessel_type', 'cold_liquor', 'Cold Liquor Tank', 'Cold water/glycol storage', NULL, 60, '{"typical_uses": ["cooling"]}'::jsonb),
  ('vessel_type', 'foeder', 'Foeder', 'Large wooden vessel for aging', NULL, 70, '{"typical_uses": ["aging", "souring"]}'::jsonb),
  ('vessel_type', 'barrel', 'Barrel', 'Aging barrel (oak, wine, spirits)', NULL, 80, '{"typical_uses": ["aging"]}'::jsonb),
  ('vessel_type', 'serving', 'Serving Tank', 'Direct-draw serving vessel', NULL, 90, '{"typical_uses": ["serving"]}'::jsonb);

-- Yeast Pitch Status
INSERT INTO enum_values (enum_type, value, label, description, color, sort_order, is_default, metadata) VALUES
  ('yeast_pitch_status', 'in_stock', 'In Stock', 'Available for use', 'success', 10, TRUE, '{"next_states": ["in_use", "discarded"]}'::jsonb),
  ('yeast_pitch_status', 'in_use', 'In Use', 'Pitched into a batch', 'warning', 20, FALSE, '{"next_states": ["harvested", "depleted"]}'::jsonb),
  ('yeast_pitch_status', 'harvested', 'Harvested', 'Yeast harvested for repitching', 'info', 30, FALSE, '{"next_states": ["in_stock"]}'::jsonb),
  ('yeast_pitch_status', 'depleted', 'Depleted', 'No viable yeast remaining', 'default', 40, FALSE, '{"next_states": []}'::jsonb),
  ('yeast_pitch_status', 'discarded', 'Discarded', 'Disposed of', 'error', 50, FALSE, '{"next_states": []}'::jsonb);

-- Yeast Source Type
INSERT INTO enum_values (enum_type, value, label, description, sort_order) VALUES
  ('yeast_source_type', 'purchase', 'Purchase', 'Purchased from supplier', 10),
  ('yeast_source_type', 'harvest', 'Harvest', 'Harvested from previous batch', 20);

-- Yeast Type
INSERT INTO enum_values (enum_type, value, label, description, sort_order) VALUES
  ('yeast_type', 'ale', 'Ale', 'Top-fermenting ale yeast', 10),
  ('yeast_type', 'lager', 'Lager', 'Bottom-fermenting lager yeast', 20),
  ('yeast_type', 'wheat', 'Wheat', 'Wheat beer yeast', 30),
  ('yeast_type', 'belgian', 'Belgian', 'Belgian style yeast', 40),
  ('yeast_type', 'wild', 'Wild', 'Wild/mixed culture yeast', 50),
  ('yeast_type', 'wine', 'Wine', 'Wine yeast', 60),
  ('yeast_type', 'champagne', 'Champagne', 'Champagne/sparkling yeast', 70),
  ('yeast_type', 'other', 'Other', 'Other yeast types', 80);

-- Yeast Form
INSERT INTO enum_values (enum_type, value, label, description, sort_order, metadata) VALUES
  ('yeast_form', 'liquid', 'Liquid', 'Liquid yeast culture', 10, '{"viability_decay_per_day": 2}'::jsonb),
  ('yeast_form', 'dry', 'Dry', 'Dry yeast packets', 20, '{"viability_decay_per_day": 0.5}'::jsonb),
  ('yeast_form', 'slurry', 'Slurry', 'Harvested yeast slurry', 30, '{"viability_decay_per_day": 3}'::jsonb);

-- User Role
INSERT INTO enum_values (enum_type, value, label, description, color, sort_order, metadata) VALUES
  ('user_role', 'admin', 'Admin', 'Full system access', 'error', 10, '{"permissions": ["all"]}'::jsonb),
  ('user_role', 'production_manager', 'Production Manager', 'Manage production, inventory, purchasing', 'warning', 20, '{"permissions": ["production", "inventory", "purchasing"]}'::jsonb),
  ('user_role', 'brewer', 'Brewer', 'Manage recipes, batches, brewing', 'info', 30, '{"permissions": ["recipes", "batches", "brewing"]}'::jsonb),
  ('user_role', 'sales', 'Sales', 'Manage orders and customers', 'success', 40, '{"permissions": ["orders", "customers"]}'::jsonb),
  ('user_role', 'viewer', 'Viewer', 'Read-only access', 'default', 50, '{"permissions": ["read"]}'::jsonb);

-- User Status
INSERT INTO enum_values (enum_type, value, label, description, color, sort_order, is_default) VALUES
  ('user_status', 'active', 'Active', 'Active user account', 'success', 10, TRUE),
  ('user_status', 'inactive', 'Inactive', 'Disabled account', 'default', 20, FALSE),
  ('user_status', 'pending', 'Pending', 'Invitation pending', 'warning', 30, FALSE);

-- Notification Status
INSERT INTO enum_values (enum_type, value, label, description, color, sort_order, is_default) VALUES
  ('notification_status', 'unread', 'Unread', 'Not yet read', 'info', 10, TRUE),
  ('notification_status', 'read', 'Read', 'Has been read', 'default', 20, FALSE),
  ('notification_status', 'archived', 'Archived', 'Archived notification', 'default', 30, FALSE);

-- Notification Severity
INSERT INTO enum_values (enum_type, value, label, description, color, sort_order, is_default) VALUES
  ('notification_severity', 'info', 'Info', 'Informational notice', 'info', 10, TRUE),
  ('notification_severity', 'warning', 'Warning', 'Warning that needs attention', 'warning', 20, FALSE),
  ('notification_severity', 'error', 'Error', 'Error that needs immediate action', 'error', 30, FALSE),
  ('notification_severity', 'success', 'Success', 'Success confirmation', 'success', 40, FALSE);

-- Location Type
INSERT INTO enum_values (enum_type, value, label, description, sort_order) VALUES
  ('location_type', 'cold_storage', 'Cold Storage', 'Refrigerated storage', 10),
  ('location_type', 'dry_storage', 'Dry Storage', 'Room temperature storage', 20),
  ('location_type', 'production', 'Production', 'Production floor area', 30),
  ('location_type', 'warehouse', 'Warehouse', 'Warehouse area', 40),
  ('location_type', 'taproom', 'Taproom', 'On-site serving area', 50),
  ('location_type', 'offsite', 'Offsite', 'Remote/distribution location', 60);

-- Package Container Type
INSERT INTO enum_values (enum_type, value, label, description, sort_order) VALUES
  ('package_container_type', 'can', 'Can', 'Aluminum can', 10),
  ('package_container_type', 'bottle', 'Bottle', 'Glass bottle', 20),
  ('package_container_type', 'keg', 'Keg', 'Keg/cask', 30),
  ('package_container_type', 'crowler', 'Crowler', '32oz crowler can', 40),
  ('package_container_type', 'growler', 'Growler', 'Refillable growler', 50);

-- Keg State
INSERT INTO enum_values (enum_type, value, label, description, color, sort_order, is_default, metadata) VALUES
  ('keg_state', 'empty', 'Empty', 'Keg is empty and clean', 'default', 10, TRUE, '{"next_states": ["filling"]}'::jsonb),
  ('keg_state', 'filling', 'Filling', 'Keg being filled', 'info', 20, FALSE, '{"next_states": ["full"]}'::jsonb),
  ('keg_state', 'full', 'Full', 'Keg is full and ready', 'success', 30, FALSE, '{"next_states": ["allocated", "tapped"]}'::jsonb),
  ('keg_state', 'allocated', 'Allocated', 'Assigned to an order', 'warning', 40, FALSE, '{"next_states": ["delivered"]}'::jsonb),
  ('keg_state', 'delivered', 'Delivered', 'At customer location', 'info', 50, FALSE, '{"next_states": ["returned", "lost"]}'::jsonb),
  ('keg_state', 'tapped', 'Tapped', 'On tap (taproom)', 'success', 60, FALSE, '{"next_states": ["empty"]}'::jsonb),
  ('keg_state', 'returned', 'Returned', 'Returned, needs cleaning', 'warning', 70, FALSE, '{"next_states": ["empty"]}'::jsonb),
  ('keg_state', 'maintenance', 'Maintenance', 'Under repair', 'error', 80, FALSE, '{"next_states": ["empty", "lost"]}'::jsonb),
  ('keg_state', 'lost', 'Lost', 'Keg is lost/missing', 'error', 90, FALSE, '{"next_states": []}'::jsonb);

-- Keg Transaction Type
INSERT INTO enum_values (enum_type, value, label, description, sort_order, metadata) VALUES
  ('keg_transaction_type', 'fill', 'Fill', 'Fill keg from finished good', 10, '{"affects_inventory": true}'::jsonb),
  ('keg_transaction_type', 'deliver', 'Deliver', 'Deliver to customer', 20, '{"affects_inventory": false}'::jsonb),
  ('keg_transaction_type', 'return', 'Return', 'Customer returns keg', 30, '{"affects_inventory": false}'::jsonb),
  ('keg_transaction_type', 'tap', 'Tap', 'Put on tap in taproom', 40, '{"affects_inventory": false}'::jsonb),
  ('keg_transaction_type', 'empty', 'Empty', 'Mark keg as empty', 50, '{"affects_inventory": false}'::jsonb),
  ('keg_transaction_type', 'adjust', 'Adjust', 'Inventory adjustment', 60, '{"affects_inventory": true}'::jsonb),
  ('keg_transaction_type', 'lost', 'Lost', 'Mark keg as lost', 70, '{"affects_inventory": false}'::jsonb),
  ('keg_transaction_type', 'found', 'Found', 'Recover lost keg', 80, '{"affects_inventory": false}'::jsonb);

-- Catalog Type (for inventory items)
INSERT INTO enum_values (enum_type, value, label, description, sort_order) VALUES
  ('catalog_type', 'grain', 'Grain', 'Malts and grains', 10),
  ('catalog_type', 'hop', 'Hop', 'Hops and hop products', 20),
  ('catalog_type', 'yeast', 'Yeast', 'Yeast and cultures', 30),
  ('catalog_type', 'adjunct', 'Adjunct', 'Adjuncts and sugars', 40),
  ('catalog_type', 'chemical', 'Chemical', 'Water chemistry and cleaning', 50),
  ('catalog_type', 'packaging', 'Packaging', 'Cans, bottles, labels', 60),
  ('catalog_type', 'equipment', 'Equipment', 'Brewing equipment', 70),
  ('catalog_type', 'other', 'Other', 'Other supplies', 80);

-- Volume Unit
INSERT INTO enum_values (enum_type, value, label, description, sort_order, metadata) VALUES
  ('volume_unit', 'bbl', 'Barrels', 'US Barrels (31 gal)', 10, '{"to_liters": 117.347765}'::jsonb),
  ('volume_unit', 'gal', 'Gallons', 'US Gallons', 20, '{"to_liters": 3.78541}'::jsonb),
  ('volume_unit', 'L', 'Liters', 'Liters', 30, '{"to_liters": 1}'::jsonb),
  ('volume_unit', 'hl', 'Hectoliters', 'Hectoliters', 40, '{"to_liters": 100}'::jsonb),
  ('volume_unit', 'ml', 'Milliliters', 'Milliliters', 50, '{"to_liters": 0.001}'::jsonb);

-- Weight Unit
INSERT INTO enum_values (enum_type, value, label, description, sort_order, metadata) VALUES
  ('weight_unit', 'lb', 'Pounds', 'Pounds', 10, '{"to_kg": 0.453592}'::jsonb),
  ('weight_unit', 'kg', 'Kilograms', 'Kilograms', 20, '{"to_kg": 1}'::jsonb),
  ('weight_unit', 'oz', 'Ounces', 'Ounces', 30, '{"to_kg": 0.0283495}'::jsonb),
  ('weight_unit', 'g', 'Grams', 'Grams', 40, '{"to_kg": 0.001}'::jsonb);

-- Temperature Unit
INSERT INTO enum_values (enum_type, value, label, description, sort_order) VALUES
  ('temperature_unit', 'F', 'Fahrenheit', 'Degrees Fahrenheit', 10),
  ('temperature_unit', 'C', 'Celsius', 'Degrees Celsius', 20);

-- Gravity Unit
INSERT INTO enum_values (enum_type, value, label, description, sort_order) VALUES
  ('gravity_unit', 'SG', 'Specific Gravity', 'Specific Gravity (1.xxx)', 10),
  ('gravity_unit', 'P', 'Plato', 'Degrees Plato', 20),
  ('gravity_unit', 'Brix', 'Brix', 'Degrees Brix', 30);

-- Fermentation Stage
INSERT INTO enum_values (enum_type, value, label, description, sort_order) VALUES
  ('fermentation_stage', 'primary', 'Primary', 'Primary fermentation', 10),
  ('fermentation_stage', 'secondary', 'Secondary', 'Secondary fermentation', 20),
  ('fermentation_stage', 'diacetyl_rest', 'Diacetyl Rest', 'Diacetyl rest (lagers)', 30),
  ('fermentation_stage', 'cold_crash', 'Cold Crash', 'Cold crashing', 40),
  ('fermentation_stage', 'lagering', 'Lagering', 'Lagering period', 50),
  ('fermentation_stage', 'conditioning', 'Conditioning', 'Conditioning/maturation', 60);

-- Mash Step Type
INSERT INTO enum_values (enum_type, value, label, description, sort_order, metadata) VALUES
  ('mash_step_type', 'acid_rest', 'Acid Rest', 'Lower pH (95-113°F)', 10, '{"temp_range_f": [95, 113]}'::jsonb),
  ('mash_step_type', 'protein_rest', 'Protein Rest', 'Break down proteins (113-138°F)', 20, '{"temp_range_f": [113, 138]}'::jsonb),
  ('mash_step_type', 'beta_amylase', 'Beta Amylase', 'Create fermentable sugars (131-150°F)', 30, '{"temp_range_f": [131, 150]}'::jsonb),
  ('mash_step_type', 'alpha_amylase', 'Alpha Amylase', 'Create dextrins (154-162°F)', 40, '{"temp_range_f": [154, 162]}'::jsonb),
  ('mash_step_type', 'saccharification', 'Saccharification', 'Full conversion (148-158°F)', 50, '{"temp_range_f": [148, 158]}'::jsonb),
  ('mash_step_type', 'mash_out', 'Mash Out', 'Stop enzyme activity (168-170°F)', 60, '{"temp_range_f": [168, 170]}'::jsonb);

-- Packaging Session Status
INSERT INTO enum_values (enum_type, value, label, description, color, sort_order, is_default, metadata) VALUES
  ('packaging_session_status', 'planned', 'Planned', 'Session scheduled', 'default', 10, TRUE, '{"next_states": ["in_progress"]}'::jsonb),
  ('packaging_session_status', 'in_progress', 'In Progress', 'Currently packaging', 'warning', 20, FALSE, '{"next_states": ["completed", "cancelled"]}'::jsonb),
  ('packaging_session_status', 'completed', 'Completed', 'Packaging finished', 'success', 30, FALSE, '{"next_states": []}'::jsonb),
  ('packaging_session_status', 'cancelled', 'Cancelled', 'Session cancelled', 'error', 40, FALSE, '{"next_states": []}'::jsonb);

-- =============================================================================
-- 3. Helper functions
-- =============================================================================

-- Get all values for an enum type
CREATE OR REPLACE FUNCTION get_enum_values(p_enum_type TEXT, p_active_only BOOLEAN DEFAULT TRUE)
RETURNS TABLE (
  value TEXT,
  label TEXT,
  description TEXT,
  color TEXT,
  icon TEXT,
  sort_order INTEGER,
  metadata JSONB
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT value, label, description, color, icon, sort_order, metadata
  FROM enum_values
  WHERE enum_type = p_enum_type
    AND (NOT p_active_only OR is_active = TRUE)
  ORDER BY sort_order, label;
$$;

-- Get default value for an enum type
CREATE OR REPLACE FUNCTION get_enum_default(p_enum_type TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT value
  FROM enum_values
  WHERE enum_type = p_enum_type AND is_default = TRUE AND is_active = TRUE
  LIMIT 1;
$$;

-- Validate enum value
CREATE OR REPLACE FUNCTION is_valid_enum(p_enum_type TEXT, p_value TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM enum_values
    WHERE enum_type = p_enum_type AND value = p_value AND is_active = TRUE
  );
$$;

-- Get enum label for a value
CREATE OR REPLACE FUNCTION get_enum_label(p_enum_type TEXT, p_value TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT label
  FROM enum_values
  WHERE enum_type = p_enum_type AND value = p_value;
$$;

-- Get all enum types
CREATE OR REPLACE FUNCTION get_enum_types()
RETURNS TABLE (
  enum_type TEXT,
  value_count BIGINT,
  has_colors BOOLEAN,
  has_metadata BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    enum_type,
    COUNT(*) AS value_count,
    BOOL_OR(color IS NOT NULL) AS has_colors,
    BOOL_OR(metadata != '{}'::jsonb) AS has_metadata
  FROM enum_values
  WHERE is_active = TRUE
  GROUP BY enum_type
  ORDER BY enum_type;
$$;

-- =============================================================================
-- 4. Row Level Security
-- =============================================================================

ALTER TABLE enum_values ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read enum values
CREATE POLICY enum_values_select ON enum_values
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Only admins can modify enum values
CREATE POLICY enum_values_modify ON enum_values
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- =============================================================================
-- 5. Triggers
-- =============================================================================

CREATE TRIGGER update_enum_values_updated_at
  BEFORE UPDATE ON enum_values
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- =============================================================================
-- 6. Schema Registry Entry
-- =============================================================================

INSERT INTO _schema_registry (
  table_name,
  description,
  domain,
  relationships,
  key_fields,
  query_examples,
  ai_context,
  calculated_fields
) VALUES (
  'enum_values',
  'Centralized registry for all enum values in the system. Enables dynamic enum management and AI integration.',
  'system',
  '{}'::jsonb,
  '["enum_type", "value", "label", "is_active"]'::jsonb,
  '["List all batch statuses", "Get valid vessel types", "What user roles exist?", "Show enum values with colors"]'::jsonb,
  '"Central enum registry. Query get_enum_values(type) to get valid values for any enum. Use get_enum_types() to see all available enums."'::jsonb,
  '[]'::jsonb
)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships,
  key_fields = EXCLUDED.key_fields,
  query_examples = EXCLUDED.query_examples,
  ai_context = EXCLUDED.ai_context,
  calculated_fields = EXCLUDED.calculated_fields;
