-- Add optimistic locking to high-contention tables.
-- Prevents lost updates when multiple users edit concurrently.
-- The entity-service.ts already supports version checks when a version column exists.

-- Batches
ALTER TABLE batches ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- Orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- Purchase Orders
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- Trigger function to auto-increment version on update
CREATE OR REPLACE FUNCTION increment_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$;

CREATE TRIGGER batches_version_trigger
  BEFORE UPDATE ON batches
  FOR EACH ROW EXECUTE FUNCTION increment_version();

CREATE TRIGGER orders_version_trigger
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION increment_version();

CREATE TRIGGER purchase_orders_version_trigger
  BEFORE UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION increment_version();
