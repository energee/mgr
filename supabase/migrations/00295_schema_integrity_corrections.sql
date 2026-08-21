-- Migration: 00295_schema_integrity_corrections.sql
-- Schema audit 2026-08-21 (docs/plans/2026-08-21-schema-audit.md, M3–M6):
-- registry correction + missing FKs + missing CHECK constraints.
--
-- All constraints follow the 00192 house pattern: guarded ADD CONSTRAINT
-- (safe on replay and if applied out-of-band), NOT VALID, then immediate
-- VALIDATE. Note the CLI applies the whole file in one transaction, so the
-- ADD CONSTRAINT's ACCESS EXCLUSIVE lock is held until commit either way;
-- these tables are small enough that the lock lasts milliseconds.

-- =============================================================================
-- 1. M4 — _schema_registry: batches.key_fields advertised columns that no
--    longer exist. 00005 set it to ["batch_number", "name", "status",
--    "planned_start_date", "fermenter"]; "fermenter" was dropped in 00209 and
--    the identifier column has been batch_code (not batch_number) since 00155.
--    The AI layer (get_ai_schema_context) reads this, so it was being told
--    about nonexistent columns.
-- =============================================================================
UPDATE _schema_registry
SET key_fields = '["batch_code", "name", "status", "planned_start_date"]'::jsonb
WHERE table_name = 'batches';

-- =============================================================================
-- 2. M5 — notifications / notification_preferences: user_id had no FK
--    (00020 created both columns bare). Sibling per-user tables all cascade
--    from auth.users; deleting a user orphaned notification rows.
--    Orphans (rows for already-deleted users — exactly what ON DELETE CASCADE
--    would have removed) are deleted before VALIDATE so it cannot fail.
-- =============================================================================
DELETE FROM notifications n
WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = n.user_id);

DELETE FROM notification_preferences np
WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = np.user_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notifications_user_id_fkey'
      AND conrelid = 'notifications'::regclass
  ) THEN
    ALTER TABLE notifications
      ADD CONSTRAINT notifications_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END;
$$;

ALTER TABLE notifications VALIDATE CONSTRAINT notifications_user_id_fkey;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notification_preferences_user_id_fkey'
      AND conrelid = 'notification_preferences'::regclass
  ) THEN
    ALTER TABLE notification_preferences
      ADD CONSTRAINT notification_preferences_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END;
$$;

ALTER TABLE notification_preferences VALIDATE CONSTRAINT notification_preferences_user_id_fkey;

-- =============================================================================
-- 3. M3 — orders.status CHECK. 00192 already adds orders_status_check with
--    exactly these values, but the 2026-08-21 audit found no CHECK on the
--    LIVE orders table (00271 bypassed triggers via replica mode; the
--    constraint may have been dropped out-of-band). Re-adding under the same
--    guard is a no-op on replay and restores the constraint on live.
--    Values mirror the order state machine in src/entities/order/core.ts —
--    if that drifts, update this constraint in lock-step (00192 rule).
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_status_check'
      AND conrelid = 'orders'::regclass
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_status_check
      CHECK (status IN (
        'draft', 'confirmed', 'scheduled', 'picking', 'packed',
        'fulfilled', 'cancelled'
      )) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE orders VALIDATE CONSTRAINT orders_status_check;

-- =============================================================================
-- 4. M6 — batch_blends: no self-blend CHECK, and its two batch FKs (00055,
--    inline REFERENCES with no ON DELETE) defaulted to NO ACTION while every
--    sibling batch child table cascades. Recreate both FKs with
--    ON DELETE CASCADE. FKs are dropped dynamically: names can drift between
--    chain and live.
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'batch_blends_no_self_blend'
      AND conrelid = 'batch_blends'::regclass
  ) THEN
    ALTER TABLE batch_blends
      ADD CONSTRAINT batch_blends_no_self_blend
      CHECK (blend_batch_id <> source_batch_id) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE batch_blends VALIDATE CONSTRAINT batch_blends_no_self_blend;

DO $$
DECLARE
  _con TEXT;
BEGIN
  -- Drop any existing batch-referencing FKs on batch_blends that do not
  -- already cascade, then recreate with ON DELETE CASCADE.
  FOR _con IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'batch_blends'::regclass
      AND contype = 'f'
      AND confrelid = 'batches'::regclass
      AND confdeltype <> 'c'  -- keep FKs that already cascade
  LOOP
    EXECUTE format('ALTER TABLE batch_blends DROP CONSTRAINT %I', _con);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'batch_blends_blend_batch_id_fkey'
      AND conrelid = 'batch_blends'::regclass
  ) THEN
    ALTER TABLE batch_blends
      ADD CONSTRAINT batch_blends_blend_batch_id_fkey
      FOREIGN KEY (blend_batch_id) REFERENCES batches(id) ON DELETE CASCADE
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'batch_blends_source_batch_id_fkey'
      AND conrelid = 'batch_blends'::regclass
  ) THEN
    ALTER TABLE batch_blends
      ADD CONSTRAINT batch_blends_source_batch_id_fkey
      FOREIGN KEY (source_batch_id) REFERENCES batches(id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END;
$$;

ALTER TABLE batch_blends VALIDATE CONSTRAINT batch_blends_blend_batch_id_fkey;
ALTER TABLE batch_blends VALIDATE CONSTRAINT batch_blends_source_batch_id_fkey;
