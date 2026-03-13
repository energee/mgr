-- Migration: Server-side state machine enforcement (C1)
--
-- Adds a database trigger that validates state transitions on UPDATE for all
-- stateful entities. This prevents bypassing client-side state machine logic
-- via direct API calls to Supabase/PostgREST.
--
-- The transition map is stored as a JSONB lookup table in a function so it
-- lives alongside the schema and stays in sync with the TypeScript configs.

-- =============================================================================
-- 1. GENERIC TRANSITION VALIDATOR
-- =============================================================================

CREATE OR REPLACE FUNCTION validate_state_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_transitions JSONB;
  v_allowed     JSONB;
  v_old_status  TEXT;
  v_new_status  TEXT;
BEGIN
  -- Only fire when the status column actually changes
  v_old_status := OLD.status;
  v_new_status := NEW.status;

  IF v_old_status IS NOT DISTINCT FROM v_new_status THEN
    RETURN NEW;
  END IF;

  -- Load the transition map for this table
  v_transitions := get_state_transitions(TG_TABLE_NAME);

  IF v_transitions IS NULL THEN
    -- No transition map registered for this table; allow anything
    RETURN NEW;
  END IF;

  -- Look up allowed target states from current state
  v_allowed := v_transitions -> v_old_status;

  IF v_allowed IS NULL THEN
    RAISE EXCEPTION 'Invalid current state "%" for table %', v_old_status, TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;

  -- Check if the new state is in the allowed list
  IF NOT v_allowed ? v_new_status THEN
    RAISE EXCEPTION 'Invalid state transition: % → % (table: %). Allowed: %',
      v_old_status, v_new_status, TG_TABLE_NAME, v_allowed
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION validate_state_transition IS
  'Generic trigger function that enforces state machine transitions. '
  'Reads allowed transitions from get_state_transitions(table_name).';

-- =============================================================================
-- 2. TRANSITION MAP REGISTRY
-- =============================================================================

-- Returns the allowed transitions for a given table as JSONB.
-- Format: { "state": ["allowed_target_1", "allowed_target_2"], ... }
-- Terminal states map to empty arrays.
CREATE OR REPLACE FUNCTION get_state_transitions(p_table_name TEXT)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN CASE p_table_name
    -- Batches: planned → fermenting → conditioning → packaging → completed
    WHEN 'batches' THEN '{
      "planned":      ["fermenting", "cancelled"],
      "fermenting":   ["conditioning", "archived"],
      "conditioning": ["packaging", "archived"],
      "packaging":    ["completed", "archived"],
      "completed":    [],
      "cancelled":    [],
      "archived":     []
    }'::JSONB

    -- Orders: draft → confirmed → scheduled → picking → packed → fulfilled
    WHEN 'orders' THEN '{
      "draft":     ["confirmed", "cancelled"],
      "confirmed": ["scheduled", "cancelled"],
      "scheduled": ["picking", "cancelled"],
      "picking":   ["packed", "cancelled"],
      "packed":    ["fulfilled", "cancelled"],
      "fulfilled": [],
      "cancelled": []
    }'::JSONB

    -- Purchase Orders: draft → submitted → confirmed → partial/fulfilled → closed
    WHEN 'purchase_orders' THEN '{
      "draft":     ["submitted", "cancelled"],
      "submitted": ["confirmed", "cancelled"],
      "confirmed": ["partial", "fulfilled", "cancelled"],
      "partial":   ["fulfilled", "cancelled"],
      "fulfilled": ["closed"],
      "cancelled": [],
      "closed":    []
    }'::JSONB

    -- Packaging Sessions: planned → in_progress → completed → revised
    WHEN 'packaging_sessions' THEN '{
      "planned":     ["in_progress", "cancelled"],
      "in_progress": ["completed", "cancelled"],
      "completed":   ["revised"],
      "revised":     [],
      "cancelled":   []
    }'::JSONB

    -- Brew Logs: draft → in_progress → completed
    WHEN 'brew_logs' THEN '{
      "draft":       ["in_progress", "cancelled"],
      "in_progress": ["completed", "cancelled"],
      "completed":   [],
      "cancelled":   []
    }'::JSONB

    -- Allocations: planned → pending_approval/completed, pending_approval → completed/rejected
    WHEN 'allocations' THEN '{
      "planned":          ["pending_approval", "completed", "cancelled"],
      "pending_approval": ["completed", "rejected"],
      "completed":        [],
      "rejected":         [],
      "cancelled":        []
    }'::JSONB

    -- Pick Lists: pending → in_progress → completed
    WHEN 'pick_lists' THEN '{
      "pending":     ["in_progress", "cancelled"],
      "in_progress": ["completed", "cancelled"],
      "completed":   [],
      "cancelled":   []
    }'::JSONB

    -- Recipes: draft → spec → complete (simple linear)
    WHEN 'recipes' THEN '{
      "draft":    ["spec", "complete"],
      "spec":     ["draft", "complete"],
      "complete": ["draft"]
    }'::JSONB

    ELSE NULL
  END;
END;
$$;

COMMENT ON FUNCTION get_state_transitions IS
  'Returns the allowed state transitions for a given table as JSONB. '
  'This is the single source of truth for server-side state machine enforcement. '
  'Must stay in sync with TypeScript StateMachineConfig definitions in src/entities/.';

-- =============================================================================
-- 3. ATTACH TRIGGERS TO ALL STATEFUL TABLES
-- =============================================================================

-- Batches
DROP TRIGGER IF EXISTS trg_validate_batch_status ON batches;
CREATE TRIGGER trg_validate_batch_status
  BEFORE UPDATE OF status ON batches
  FOR EACH ROW
  EXECUTE FUNCTION validate_state_transition();

-- Orders
DROP TRIGGER IF EXISTS trg_validate_order_status ON orders;
CREATE TRIGGER trg_validate_order_status
  BEFORE UPDATE OF status ON orders
  FOR EACH ROW
  EXECUTE FUNCTION validate_state_transition();

-- Purchase Orders
DROP TRIGGER IF EXISTS trg_validate_po_status ON purchase_orders;
CREATE TRIGGER trg_validate_po_status
  BEFORE UPDATE OF status ON purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION validate_state_transition();

-- Packaging Sessions
DROP TRIGGER IF EXISTS trg_validate_packaging_status ON packaging_sessions;
CREATE TRIGGER trg_validate_packaging_status
  BEFORE UPDATE OF status ON packaging_sessions
  FOR EACH ROW
  EXECUTE FUNCTION validate_state_transition();

-- Brew Logs
DROP TRIGGER IF EXISTS trg_validate_brew_log_status ON brew_logs;
CREATE TRIGGER trg_validate_brew_log_status
  BEFORE UPDATE OF status ON brew_logs
  FOR EACH ROW
  EXECUTE FUNCTION validate_state_transition();

-- Allocations
DROP TRIGGER IF EXISTS trg_validate_allocation_status ON allocations;
CREATE TRIGGER trg_validate_allocation_status
  BEFORE UPDATE OF status ON allocations
  FOR EACH ROW
  EXECUTE FUNCTION validate_state_transition();

-- Pick Lists
DROP TRIGGER IF EXISTS trg_validate_pick_list_status ON pick_lists;
CREATE TRIGGER trg_validate_pick_list_status
  BEFORE UPDATE OF status ON pick_lists
  FOR EACH ROW
  EXECUTE FUNCTION validate_state_transition();

-- Recipes
DROP TRIGGER IF EXISTS trg_validate_recipe_status ON recipes;
CREATE TRIGGER trg_validate_recipe_status
  BEFORE UPDATE OF status ON recipes
  FOR EACH ROW
  EXECUTE FUNCTION validate_state_transition();

-- =============================================================================
-- 4. SCHEMA REGISTRY
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields, ai_context)
VALUES (
  'validate_state_transition',
  'Server-side state machine enforcement trigger function. Validates all status column changes against allowed transitions.',
  'system',
  NULL,
  '["TG_TABLE_NAME", "status"]'::jsonb,
  '["Enforces state transitions at DB level", "get_state_transitions() holds the transition map", "Raises check_violation on invalid transitions"]'::jsonb
)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  key_fields = EXCLUDED.key_fields,
  ai_context = EXCLUDED.ai_context;
