CREATE VIEW vessel_transfers_with_details
WITH (security_invoker = true)
AS
SELECT
  vt.*,
  fv.name AS from_vessel_name,
  tv.name AS to_vessel_name,
  b.batch_number
FROM vessel_transfers vt
LEFT JOIN vessels fv ON vt.from_vessel_id = fv.id
JOIN vessels tv ON vt.to_vessel_id = tv.id
LEFT JOIN batches b ON vt.batch_id = b.id;

COMMENT ON VIEW vessel_transfers_with_details IS 'Vessel transfers with joined vessel and batch names';
