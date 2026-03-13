-- Migration: Sequential number generation safety
--
-- Fixes race conditions (C2, C5, C6) where concurrent requests using
-- SELECT max(number) + 1 can produce duplicate sequential numbers.
--
-- Strategy:
--   1. Add UNIQUE constraint on finished_goods.lot_number (batches and
--      purchase_orders already have one).
--   2. Create a reusable generate_next_number() function that uses
--      pg_advisory_xact_lock to serialize number generation.
--   3. Replace the existing generate_lot_number() with a version that
--      delegates to generate_next_number().

-- =============================================================================
-- 1. UNIQUE CONSTRAINTS
-- =============================================================================

-- finished_goods.lot_number has no uniqueness guarantee yet
ALTER TABLE finished_goods
  ADD CONSTRAINT finished_goods_lot_number_key UNIQUE (lot_number);

-- batches.batch_number already has batches_batch_number_key (from 00002)
-- purchase_orders.po_number already has UNIQUE inline (from 00010)

-- =============================================================================
-- 2. REUSABLE NUMBER GENERATOR WITH ADVISORY LOCK
-- =============================================================================

-- Advisory lock namespace: we hash the table+column name to get a stable
-- lock ID so different counters don't block each other.
CREATE OR REPLACE FUNCTION generate_next_number(
  p_table  TEXT,
  p_column TEXT,
  p_prefix TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_lock_id  BIGINT;
  v_max_seq  INTEGER;
  v_next_seq INTEGER;
  v_result   TEXT;
  v_pattern  TEXT;
  v_sql      TEXT;
BEGIN
  -- Derive a stable lock ID from table + column + prefix so each series
  -- gets its own lock without blocking unrelated generators.
  v_lock_id := hashtext(p_table || '.' || p_column || '.' || COALESCE(p_prefix, ''));

  -- Acquire a transaction-scoped advisory lock. This serializes concurrent
  -- callers for the *same* series while allowing different series to proceed
  -- in parallel.
  PERFORM pg_advisory_xact_lock(v_lock_id);

  -- Build a LIKE pattern for the prefix
  IF p_prefix IS NOT NULL THEN
    v_pattern := p_prefix || '%';
  ELSE
    v_pattern := '%';
  END IF;

  -- Dynamically query the max existing sequence number.
  -- We extract the trailing integer after the last '-' separator.
  v_sql := format(
    $sql$
      SELECT COALESCE(MAX(
        CASE
          WHEN %I ~ ($1 || '[0-9]+$')
          THEN CAST(regexp_replace(%I, '^.*-', '') AS INTEGER)
          ELSE 0
        END
      ), 0)
      FROM %I
      WHERE %I LIKE $2
    $sql$,
    p_column, p_column, p_table, p_column
  );

  EXECUTE v_sql INTO v_max_seq USING
    COALESCE(p_prefix, ''),
    v_pattern;

  v_next_seq := v_max_seq + 1;

  -- Format result: prefix + zero-padded 3-digit sequence
  IF p_prefix IS NOT NULL THEN
    v_result := p_prefix || lpad(v_next_seq::TEXT, 3, '0');
  ELSE
    v_result := lpad(v_next_seq::TEXT, 3, '0');
  END IF;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION generate_next_number IS
  'Race-condition-safe sequential number generator using pg_advisory_xact_lock. '
  'Generates numbers in format PREFIX-NNN. Lock scope is per table+column+prefix.';

-- =============================================================================
-- 3. DOMAIN-SPECIFIC WRAPPER: BATCH NUMBER
-- =============================================================================

-- Generates batch numbers in YYYY-NNN format
CREATE OR REPLACE FUNCTION generate_next_batch_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN generate_next_number(
    'batches',
    'batch_number',
    to_char(CURRENT_DATE, 'YYYY') || '-'
  );
END;
$$;

COMMENT ON FUNCTION generate_next_batch_number IS
  'Generates the next batch number in YYYY-NNN format, safe under concurrency.';

-- =============================================================================
-- 4. DOMAIN-SPECIFIC WRAPPER: PO NUMBER
-- =============================================================================

-- Generates PO numbers in PO-YYYY-NNN format
CREATE OR REPLACE FUNCTION generate_next_po_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN generate_next_number(
    'purchase_orders',
    'po_number',
    'PO-' || to_char(CURRENT_DATE, 'YYYY') || '-'
  );
END;
$$;

COMMENT ON FUNCTION generate_next_po_number IS
  'Generates the next PO number in PO-YYYY-NNN format, safe under concurrency.';

-- =============================================================================
-- 5. REPLACE EXISTING generate_lot_number WITH SAFE VERSION
-- =============================================================================

CREATE OR REPLACE FUNCTION generate_lot_number(p_date DATE)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN generate_next_number(
    'finished_goods',
    'lot_number',
    to_char(p_date, 'YYYYMMDD') || '-'
  );
END;
$$;

-- Comment already exists from 00026, but update it
COMMENT ON FUNCTION generate_lot_number IS
  'Generates lot numbers in YYYYMMDD-NNN format, safe under concurrency. '
  'Delegates to generate_next_number() with advisory locking.';

-- =============================================================================
-- 6. SCHEMA REGISTRY
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields, ai_context)
VALUES (
  'generate_next_number',
  'Race-condition-safe sequential number generator function using pg_advisory_xact_lock',
  'system',
  NULL,
  '["p_table", "p_column", "p_prefix"]'::jsonb,
  '["SELECT generate_next_batch_number()", "SELECT generate_next_po_number()", "SELECT generate_lot_number(CURRENT_DATE)"]'::jsonb
)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  key_fields = EXCLUDED.key_fields,
  ai_context = EXCLUDED.ai_context;
