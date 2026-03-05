-- Migration: pricing_channel_formats
-- Per-channel format visibility for the pricing matrix.
-- A row in this junction table means the format is visible for that channel.

-- =============================================================================
-- Table
-- =============================================================================

CREATE TABLE pricing_channel_formats (
  sales_channel_id UUID NOT NULL REFERENCES sales_channels(id) ON DELETE CASCADE,
  format_id        UUID NOT NULL,
  PRIMARY KEY (sales_channel_id, format_id)
);

COMMENT ON TABLE pricing_channel_formats IS
  'Junction table controlling which packaging formats are visible per sales channel in the pricing matrix.';

-- =============================================================================
-- RLS
-- =============================================================================

ALTER TABLE pricing_channel_formats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view pricing channel formats"
  ON pricing_channel_formats FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert pricing channel formats"
  ON pricing_channel_formats FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete pricing channel formats"
  ON pricing_channel_formats FOR DELETE
  TO authenticated
  USING (true);

-- =============================================================================
-- Seed: copy existing show_in_pricing state into every active channel
-- =============================================================================

INSERT INTO pricing_channel_formats (sales_channel_id, format_id)
SELECT sc.id, pf.id
FROM sales_channels sc
CROSS JOIN packaging_formats pf
WHERE sc.is_active = true
  AND pf.is_active = true
  AND pf.show_in_pricing = true;

-- =============================================================================
-- Schema Registry
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships)
VALUES (
  'pricing_channel_formats',
  'Junction table: which packaging formats appear in the pricing matrix for each sales channel',
  'sales',
  '[{"type":"belongsTo","target":"sales_channels","fk":"sales_channel_id"},{"type":"referencesFormat","target":"packaging_formats","fk":"format_id"}]'
)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships;
