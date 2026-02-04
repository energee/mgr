-- View: packaging sessions with aggregated line item summary
CREATE VIEW packaging_sessions_with_summary
WITH (security_invoker = true)
AS
SELECT
  ps.*,
  COALESCE(agg.line_count, 0) AS line_count,
  agg.brands,
  COALESCE(agg.total_planned, 0) AS total_planned,
  COALESCE(agg.total_actual, 0) AS total_actual
FROM packaging_sessions ps
LEFT JOIN (
  SELECT
    sli.session_id,
    COUNT(*) AS line_count,
    STRING_AGG(DISTINCT b.name, ', ' ORDER BY b.name) AS brands,
    SUM(sli.planned_quantity) AS total_planned,
    SUM(sli.actual_quantity) AS total_actual
  FROM session_line_items sli
  JOIN brands b ON b.id = sli.brand_id
  GROUP BY sli.session_id
) agg ON agg.session_id = ps.id;

COMMENT ON VIEW packaging_sessions_with_summary IS 'Packaging sessions with aggregated line item counts, brand names, and quantity totals.';

-- Update schema registry
UPDATE _schema_registry
SET key_fields = '["session_date", "status", "brands", "total_planned", "total_actual"]',
    updated_at = NOW()
WHERE table_name = 'packaging_sessions';
