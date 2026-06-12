-- Auto-generate brew_number server-side: BRW-YYYY-DDD with dedup suffix
--
-- Previously StartBrewDayDialog generated BRW-{year}-{dayOfYear} client-side with
-- no sequence component, so the second brew started on the same calendar day
-- violated the brew_logs brew_number UNIQUE constraint (00004_brew_logs.sql) and
-- failed on submit. This mirrors the generate_batch_code() precedent from
-- 00155_auto_generate_batch_number.sql: a BEFORE INSERT trigger generates the
-- number when none is provided, appending -2, -3, ... on collision.
--
-- Clients may still supply an explicit brew_number; generation only kicks in for
-- NULL/empty values. No type regeneration strictly required: app code always
-- sends brew_number as a string ('' to request auto-generation).

-- Allow inserts to omit brew_number entirely (resolves to '' → trigger generates)
ALTER TABLE brew_logs ALTER COLUMN brew_number SET DEFAULT '';

-- =============================================================================
-- Auto-generation trigger function
-- =============================================================================

CREATE OR REPLACE FUNCTION generate_brew_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  use_date DATE;
  base_number TEXT;
  candidate TEXT;
  suffix INT;
BEGIN
  -- Only generate when not explicitly provided
  IF NEW.brew_number IS NOT NULL AND NEW.brew_number <> '' THEN
    RETURN NEW;
  END IF;

  -- Date: prefer the row's brew_date, fall back to today
  use_date := COALESCE(NEW.brew_date, CURRENT_DATE);

  -- Format: BRW-YYYY-DDD (zero-padded day of year), matching the legacy
  -- client-side format so existing brew numbers sort/scan consistently
  base_number := 'BRW-' || extract(year from use_date)::int || '-'
              || lpad(extract(doy from use_date)::int::text, 3, '0');

  -- Find the first available candidate, appending -2, -3, ... on collision.
  -- Exclude the current row id (defensive parity with generate_batch_code).
  candidate := base_number;
  suffix := 1;

  WHILE EXISTS (
    SELECT 1 FROM brew_logs
    WHERE brew_number = candidate
      AND id <> NEW.id
  ) LOOP
    suffix := suffix + 1;
    candidate := base_number || '-' || suffix;
  END LOOP;

  NEW.brew_number := candidate;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION generate_brew_number() IS 'Auto-generates brew_number as BRW-YYYY-DDD (day of year from brew_date) with -2/-3 dedup suffix on INSERT when not explicitly provided.';

DROP TRIGGER IF EXISTS trg_generate_brew_number ON brew_logs;

CREATE TRIGGER trg_generate_brew_number
  BEFORE INSERT ON brew_logs
  FOR EACH ROW
  EXECUTE FUNCTION generate_brew_number();
