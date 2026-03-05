-- Add Glass as a default package container type enum value.
-- Inserted at sort_order 5 so it appears before Can.

INSERT INTO enum_values (enum_type, value, label, description, sort_order)
VALUES ('package_container_type', 'glass', 'Glass', 'Glass bottle packaging', 5)
ON CONFLICT (enum_type, value) DO NOTHING;
