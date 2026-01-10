-- MGR Seed Data (Single-Tenant)
-- Run this in the Supabase SQL Editor to create sample data for testing.
-- Note: This bypasses RLS since it runs with admin credentials.

-- =============================================================================
-- Update Settings
-- =============================================================================

UPDATE settings SET
  brewery_name = 'Demo Brewing Co',
  timezone = 'America/New_York',
  default_batch_size_gallons = 10.0
WHERE id = '00000000-0000-0000-0000-000000000001';

-- =============================================================================
-- Recipes
-- =============================================================================

INSERT INTO recipes (id, name, style, description, target_og, target_fg, target_abv, target_ibu, target_srm, batch_size_gallons, boil_time_minutes)
VALUES
  ('00000000-0000-0000-0001-000000000001',
   'Hazy Days IPA', 'New England IPA', 'Juicy, hazy IPA with tropical hop character',
   1.065, 1.012, 7.0, 45, 5, 10.0, 60),

  ('00000000-0000-0000-0001-000000000002',
   'Midnight Stout', 'American Stout', 'Rich, roasty stout with chocolate notes',
   1.072, 1.018, 7.2, 40, 35, 10.0, 60),

  ('00000000-0000-0000-0001-000000000003',
   'Summer Wheat', 'American Wheat', 'Light, refreshing wheat beer',
   1.048, 1.010, 5.0, 18, 4, 10.0, 60),

  ('00000000-0000-0000-0001-000000000004',
   'Classic Pilsner', 'German Pilsner', 'Crisp, clean lager with noble hop character',
   1.046, 1.008, 5.0, 35, 3, 10.0, 90)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- Batches
-- =============================================================================

INSERT INTO batches (id, recipe_id, batch_number, name, status, volume_gallons, brew_date, fermenter, actual_og, actual_fg, actual_abv, notes)
VALUES
  -- Completed batch
  ('00000000-0000-0000-0002-000000000001',
   '00000000-0000-0000-0001-000000000001', '2024-001', 'Hazy Days #1', 'completed',
   10.0, '2024-12-01', 'FV-1', 1.066, 1.013, 7.0, 'First batch of our NEIPA. Turned out great!'),

  -- Conditioning batch
  ('00000000-0000-0000-0002-000000000002',
   '00000000-0000-0000-0001-000000000002', '2024-002', 'Midnight Stout #1', 'conditioning',
   10.0, '2024-12-15', 'FV-2', 1.074, 1.019, 7.3, 'Conditioning for another week.'),

  -- Fermenting batch
  ('00000000-0000-0000-0002-000000000003',
   '00000000-0000-0000-0001-000000000003', '2025-001', 'Summer Wheat #1', 'fermenting',
   10.0, '2025-01-02', 'FV-1', 1.049, NULL, NULL, 'Fermentation looking healthy.'),

  -- Brewing batch
  ('00000000-0000-0000-0002-000000000004',
   '00000000-0000-0000-0001-000000000001', '2025-002', 'Hazy Days #2', 'brewing',
   10.0, '2025-01-09', 'FV-3', NULL, NULL, NULL, 'Brew day in progress.'),

  -- Planned batch
  ('00000000-0000-0000-0002-000000000005',
   '00000000-0000-0000-0001-000000000004', '2025-003', 'Classic Pilsner #1', 'planned',
   10.0, '2025-01-15', NULL, NULL, NULL, NULL, 'Scheduled for next week.')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- Package Types
-- =============================================================================

INSERT INTO package_types (id, name, container_type, volume_oz, units_per_case)
VALUES
  ('00000000-0000-0000-0003-000000000001', '16oz Can', 'can', 16.0, 24),
  ('00000000-0000-0000-0003-000000000002', '12oz Can', 'can', 12.0, 24),
  ('00000000-0000-0000-0003-000000000003', 'Half Barrel Keg', 'keg', 1984.0, 1),
  ('00000000-0000-0000-0003-000000000004', 'Sixth Barrel Keg', 'keg', 661.0, 1)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- Packages (packaged products from completed batch)
-- =============================================================================

INSERT INTO packages (id, batch_id, package_type_id, quantity, packaged_date, best_by_date, lot_code)
VALUES
  ('00000000-0000-0000-0004-000000000001',
   '00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0003-000000000001',
   240, '2024-12-20', '2025-03-20', 'HD-2024001-A'),
  ('00000000-0000-0000-0004-000000000002',
   '00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0003-000000000003',
   4, '2024-12-20', '2025-03-20', 'HD-2024001-K')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- Customers
-- =============================================================================

INSERT INTO customers (id, name, customer_type, contact_name, email, phone)
VALUES
  ('00000000-0000-0000-0005-000000000001',
   'Downtown Distributors', 'distributor', 'John Smith', 'john@downtown.dist', '555-0100'),
  ('00000000-0000-0000-0005-000000000002',
   'The Hoppy Place', 'retail', 'Jane Doe', 'jane@hoppyplace.com', '555-0101'),
  ('00000000-0000-0000-0005-000000000003',
   'Craft Corner', 'retail', 'Mike Johnson', 'mike@craftcorner.com', '555-0102')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- Orders
-- =============================================================================

INSERT INTO orders (id, customer_id, order_number, status, order_date, requested_date, notes)
VALUES
  ('00000000-0000-0000-0006-000000000001',
   '00000000-0000-0000-0005-000000000001', 'ORD-2025-001', 'confirmed',
   '2025-01-05', '2025-01-12', 'Monthly restock order'),
  ('00000000-0000-0000-0006-000000000002',
   '00000000-0000-0000-0005-000000000002', 'ORD-2025-002', 'draft',
   '2025-01-08', '2025-01-15', 'New account first order')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- Order Items
-- =============================================================================

INSERT INTO order_items (id, order_id, batch_id, package_type_id, quantity, unit_price)
VALUES
  ('00000000-0000-0000-0007-000000000001', '00000000-0000-0000-0006-000000000001',
   '00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0003-000000000001', 120, 3.50),
  ('00000000-0000-0000-0007-000000000002', '00000000-0000-0000-0006-000000000001',
   '00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0003-000000000003', 2, 180.00),
  ('00000000-0000-0000-0007-000000000003', '00000000-0000-0000-0006-000000000002',
   '00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0003-000000000001', 48, 4.00)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- Inventory Items
-- =============================================================================

INSERT INTO inventory_items (id, category, name, sku, unit, reorder_point, reorder_qty, supplier)
VALUES
  ('00000000-0000-0000-0008-000000000001',
   'grain', 'Pale Malt (2-Row)', 'GRAIN-001', 'lb', 100.0, 500.0, 'Midwest Malting'),
  ('00000000-0000-0000-0008-000000000002',
   'grain', 'Munich Malt', 'GRAIN-002', 'lb', 50.0, 200.0, 'Midwest Malting'),
  ('00000000-0000-0000-0008-000000000003',
   'hops', 'Citra Hops', 'HOPS-001', 'oz', 32.0, 64.0, 'Yakima Valley Hops'),
  ('00000000-0000-0000-0008-000000000004',
   'hops', 'Mosaic Hops', 'HOPS-002', 'oz', 32.0, 64.0, 'Yakima Valley Hops'),
  ('00000000-0000-0000-0008-000000000005',
   'yeast', 'US-05 Ale Yeast', 'YEAST-001', 'each', 10.0, 20.0, 'Fermentis'),
  ('00000000-0000-0000-0008-000000000006',
   'packaging', '16oz Cans', 'PKG-001', 'case', 20.0, 100.0, 'Ball Corporation')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- Allocations (inventory movements)
-- =============================================================================

INSERT INTO allocations (id, inventory_item_id, allocation_type, quantity, unit_cost, notes)
VALUES
  -- Initial receipts
  ('00000000-0000-0000-0009-000000000001',
   '00000000-0000-0000-0008-000000000001', 'receipt', 500.0, 0.75, 'Initial inventory'),
  ('00000000-0000-0000-0009-000000000002',
   '00000000-0000-0000-0008-000000000002', 'receipt', 200.0, 0.85, 'Initial inventory'),
  ('00000000-0000-0000-0009-000000000003',
   '00000000-0000-0000-0008-000000000003', 'receipt', 64.0, 2.50, 'Initial inventory'),
  ('00000000-0000-0000-0009-000000000004',
   '00000000-0000-0000-0008-000000000004', 'receipt', 64.0, 2.50, 'Initial inventory'),
  -- Usage for batch
  ('00000000-0000-0000-0009-000000000005',
   '00000000-0000-0000-0008-000000000001', 'batch_usage', -20.0, NULL, 'Used for 2024-001'),
  ('00000000-0000-0000-0009-000000000006',
   '00000000-0000-0000-0008-000000000003', 'batch_usage', -8.0, NULL, 'Used for 2024-001')
ON CONFLICT (id) DO NOTHING;

SELECT 'Seed data created!' AS message;
