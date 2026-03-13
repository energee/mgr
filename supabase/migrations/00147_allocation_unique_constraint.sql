-- =============================================================================
-- Migration: 00147_allocation_unique_constraint
--
-- Prevents duplicate active allocations via a unique partial index.
--
-- PROBLEM: The client-side duplicate check in order-allocation.tsx is
-- susceptible to a TOCTOU (Time-Of-Check-Time-Of-Use) race condition.
-- Two concurrent requests can both read "no existing allocation" and then
-- both insert, resulting in duplicate allocation rows. This is especially
-- likely under network latency or when multiple users allocate simultaneously.
--
-- SOLUTION: A unique partial index on (source_type, source_id,
-- destination_type, destination_id) for non-rejected/non-cancelled rows
-- enforces uniqueness at the database level, making the race harmless —
-- the second INSERT will fail with a unique constraint violation.
-- =============================================================================

-- 1. AUDIT: Check for existing duplicates that would violate the new index.
--    This DO block logs any duplicates found but does not block the migration,
--    since CREATE UNIQUE INDEX ... IF NOT EXISTS will simply skip creation if
--    the index already exists.
DO $$
DECLARE
  dup_count integer;
BEGIN
  SELECT count(*) INTO dup_count
  FROM (
    SELECT source_type, source_id, destination_type, destination_id
    FROM allocations
    WHERE status NOT IN ('rejected', 'cancelled')
    GROUP BY source_type, source_id, destination_type, destination_id
    HAVING count(*) > 1
  ) dupes;

  IF dup_count > 0 THEN
    RAISE WARNING '[00147] Found % duplicate active allocation group(s). '
      'These must be resolved before the unique index can be enforced. '
      'The index creation will fail if duplicates exist.',
      dup_count;
  END IF;
END;
$$;

-- 2. CREATE UNIQUE PARTIAL INDEX
CREATE UNIQUE INDEX IF NOT EXISTS idx_allocations_unique_active_source_dest
  ON allocations (source_type, source_id, destination_type, destination_id)
  WHERE status NOT IN ('rejected', 'cancelled');

COMMENT ON INDEX idx_allocations_unique_active_source_dest IS
  'Prevents duplicate active allocations for the same source→destination pair. '
  'Excludes rejected and cancelled rows so that re-allocation after cancellation is allowed. '
  'Closes the TOCTOU race in client-side duplicate checks.';

-- 3. SCHEMA REGISTRY
INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields, ai_context)
VALUES (
  'idx_allocations_unique_active_source_dest',
  'Unique partial index on allocations preventing duplicate active source→destination pairs (TOCTOU race fix)',
  'inventory',
  '["allocations"]'::jsonb,
  '["source_type", "source_id", "destination_type", "destination_id", "status"]'::jsonb,
  '["Prevents concurrent duplicate inserts", "Excludes rejected/cancelled rows", "Client-side check is kept as UX optimization but DB enforces correctness"]'::jsonb
)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships,
  key_fields = EXCLUDED.key_fields,
  ai_context = EXCLUDED.ai_context;
