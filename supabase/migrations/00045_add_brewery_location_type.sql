-- Add missing 'brewery' location type to enum_values
-- The location entity config uses 'brewery' but it was missing from the enum registry

INSERT INTO enum_values (enum_type, value, label, description, sort_order)
VALUES ('location_type', 'brewery', 'Brewery', 'Main brewing facility', 5)
ON CONFLICT (enum_type, value) DO NOTHING;
