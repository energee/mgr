-- Migration: Safety guard for finished_goods lot_number uniqueness
--
-- Migration 00142 added a UNIQUE constraint on finished_goods.lot_number,
-- but it would fail if duplicate lot numbers already existed. This migration
-- first de-duplicates any existing duplicates by appending a suffix, then
-- adds the constraint if it doesn't already exist.

-- Step 1: De-duplicate any existing duplicate lot numbers.
-- For each set of duplicates, append '-dupN' suffix to all but the first row.
DO $$
DECLARE
  v_rec RECORD;
  v_counter INTEGER;
BEGIN
  FOR v_rec IN
    SELECT lot_number
    FROM finished_goods
    GROUP BY lot_number
    HAVING COUNT(*) > 1
  LOOP
    v_counter := 0;
    -- Update all but the first (oldest) row with the duplicate lot_number
    UPDATE finished_goods
    SET lot_number = lot_number || '-dup' || sub.rn
    FROM (
      SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) as rn
      FROM finished_goods
      WHERE lot_number = v_rec.lot_number
    ) sub
    WHERE finished_goods.id = sub.id
      AND sub.rn > 1;
  END LOOP;
END;
$$;

-- Step 2: Add UNIQUE constraint if it doesn't already exist (idempotent guard for 00142).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'finished_goods_lot_number_key'
      AND conrelid = 'finished_goods'::regclass
  ) THEN
    ALTER TABLE finished_goods
      ADD CONSTRAINT finished_goods_lot_number_key UNIQUE (lot_number);
  END IF;
END;
$$;
