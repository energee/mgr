-- Migration: 00205_restore_server_side_enforcement (audit C2, backlog #9)
--
-- The live database lost a cluster of server-side enforcement and support
-- objects out-of-band: the migration ROWS are recorded as applied (db push is
-- a clean no-op), but the actual functions/triggers do not exist on live. This
-- migration re-asserts them so the live catalog matches the migration chain.
--
-- Verified live-vs-chain diff, 2026-07-07 (MCP SELECTs on pg_proc/pg_trigger):
--
--   MISSING on live, restored here:
--     * validate_state_transition()               (00143) — absent
--     * trg_validate_{batch,order,po,packaging,    (00143) — all 8 absent
--       brew_log,allocation,pick_list,recipe}_status
--     * cancel_pick_list_allocations() + trigger   (00108) — absent
--     * set_pick_list_timestamps() + trigger       (00106) — absent
--     * generate_next_number()                     (00142) — absent
--     * generate_next_po_number()                  (00142) — absent (app-used:
--                                                    src/domain/purchasing/po-generator.ts)
--     * generate_lot_number(date)                  (00142) — live ran the racy
--                                                    pre-00142 body (no advisory lock)
--     * generate_delivery_number()                 (00075) — live ran the racy
--                                                    pre-00075 body (no advisory lock)
--     * finished_goods_lot_number_key UNIQUE       (00142) — absent
--     * calculate_ingredient_shortfalls()          (00150) — live ran the
--                                                    pre-00150 body missing on_order_qty
--     * get_yeast_lineage_root()                   (00111) — absent (app-used:
--                                                    src/domain/yeast-lineage.ts)
--     * get_unaccepted_po_receives()               (00107) — absent (app-used:
--                                                    po-accept-inventory-dialog.tsx)
--
--   Present live and NOT re-created here (still correct per chain):
--     * get_state_transitions() — present, but its stored map is the stale
--       00167 body (orders lacked picking/packed; deliveries used non-existent
--       'loaded'/'delivered' states). We DO replace it below to re-sync the map
--       to the current entity state machines — see section 1.
--     * generate_pick_list() — present, matches 00182 (selling_format_id body).
--     * generate_next_batch_number() — correctly ABSENT: created 00142, then
--       intentionally DROPped by 00155 (batch numbering moved to
--       generate_batch_code trigger). NOT restored.
--
--   Found broken but DEFERRED (documented, not fixed here — they reference
--   schema that no longer exists, so restoring the chain body would just
--   re-break; each needs a schema-aware rewrite, tracked as follow-ups):
--     * get_inventory_overview() — JOINs the dropped `package_types` table AND
--       its return shape no longer matches the InventoryOverview TS type. Live
--       already equals the chain's latest def (00155), so this is a pre-existing
--       CHAIN bug, not drift. Needs a selling_formats rewrite. (backlog: new)
--     * start_batch_fermentation() — UPDATEs the dropped `batches.fermenter`
--       column (vessel assignment now lives on vessels.current_batch_id +
--       vessel_transfers). Needs a rewrite to the current vessel model.
--       (backlog: new)
--     * apply_change_request()          — backlog #10 (change-request rebuild).
--     * project_finished_goods/project_revenue/margin_by_channel (00139)
--                                       — backlog #19 (planned-batch ordering);
--                                          unused by the app today.
--     * save_qbo_tokens/clear_qbo_tokens/save_qbo_client_credentials (00100)
--                                       — no app callers found; integration-layer.
--     * get_price_for_customer          — present live; owned by backlog #14b
--                                          (live behavior is the intended source
--                                          of truth there). Not touched.
--
-- Idempotency / drift-guard style (matches 00197/00198): every function is
-- CREATE OR REPLACE; every trigger is DROP TRIGGER IF EXISTS then CREATE; the
-- UNIQUE constraint is guarded by a pg_constraint existence check. Safe to run
-- against both the drifted live DB and a from-scratch replay.

-- =============================================================================
-- 1. STATE MACHINE TRANSITION MAP  (re-synced to src/entities/*/core.ts)
-- =============================================================================
-- Single source of truth for server-side state enforcement. Each entry mirrors
-- the `transitions` map of the matching StateMachineConfig in src/entities/
-- (batches: src/lib/schemas/batch.ts). The live 00167 body was stale — this
-- brings orders' picking/packed workflow and the corrected deliveries states
-- back in line so the validator cannot block a transition the app performs.
--
-- Cross-checked against the TypeScript state machines on 2026-07-07:
--   batches, orders, purchase_orders, packaging_sessions, brew_logs,
--   allocations, pick_lists, recipes, deliveries — all match exactly.
CREATE OR REPLACE FUNCTION get_state_transitions(p_table_name TEXT)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN CASE p_table_name
    -- src/lib/schemas/batch.ts (batchTransitions)
    WHEN 'batches' THEN '{
      "planned":      ["fermenting", "cancelled"],
      "fermenting":   ["conditioning", "archived"],
      "conditioning": ["packaging", "archived"],
      "packaging":    ["completed", "archived"],
      "completed":    [],
      "cancelled":    [],
      "archived":     []
    }'::JSONB

    -- src/entities/order/core.ts (orderStateMachine)
    WHEN 'orders' THEN '{
      "draft":     ["confirmed", "cancelled"],
      "confirmed": ["scheduled", "cancelled"],
      "scheduled": ["picking", "cancelled"],
      "picking":   ["packed", "cancelled"],
      "packed":    ["fulfilled", "cancelled"],
      "fulfilled": [],
      "cancelled": []
    }'::JSONB

    -- src/entities/purchase-order/core.ts (purchaseOrderStateMachine)
    WHEN 'purchase_orders' THEN '{
      "draft":     ["submitted", "cancelled"],
      "submitted": ["confirmed", "cancelled"],
      "confirmed": ["partial", "fulfilled", "cancelled"],
      "partial":   ["fulfilled", "cancelled"],
      "fulfilled": ["closed"],
      "cancelled": [],
      "closed":    []
    }'::JSONB

    -- src/entities/packaging-session/core.ts (packagingSessionStateMachine)
    WHEN 'packaging_sessions' THEN '{
      "planned":     ["in_progress", "cancelled"],
      "in_progress": ["completed", "cancelled"],
      "completed":   ["revised"],
      "revised":     [],
      "cancelled":   []
    }'::JSONB

    -- src/entities/brew-log/core.ts (brewLogStateMachine)
    WHEN 'brew_logs' THEN '{
      "draft":       ["in_progress", "cancelled"],
      "in_progress": ["completed", "cancelled"],
      "completed":   [],
      "cancelled":   []
    }'::JSONB

    -- src/entities/allocation/core.ts (allocationStateMachine)
    WHEN 'allocations' THEN '{
      "planned":          ["pending_approval", "completed", "cancelled"],
      "pending_approval": ["completed", "rejected"],
      "completed":        [],
      "rejected":         [],
      "cancelled":        []
    }'::JSONB

    -- src/entities/pick-list/core.ts (pickListStateMachine)
    WHEN 'pick_lists' THEN '{
      "draft":       ["assigned", "cancelled"],
      "assigned":    ["in_progress", "cancelled"],
      "in_progress": ["completed", "cancelled"],
      "completed":   [],
      "cancelled":   []
    }'::JSONB

    -- src/entities/recipe/core.ts (recipeStateMachine)
    WHEN 'recipes' THEN '{
      "draft":    ["spec", "complete"],
      "spec":     ["complete"],
      "complete": []
    }'::JSONB

    -- src/entities/delivery/core.ts (deliveryStateMachine). Mapped for
    -- completeness/consistency; deliveries has no validation trigger (the chain
    -- never attached one — attaching would be a behavior change, not a
    -- restoration), so this entry is currently dormant.
    WHEN 'deliveries' THEN '{
      "planned":    ["in_transit", "cancelled"],
      "in_transit": ["completed", "cancelled"],
      "completed":  [],
      "cancelled":  []
    }'::JSONB

    ELSE NULL
  END;
END;
$$;

COMMENT ON FUNCTION get_state_transitions IS
  'Returns the allowed state transitions for a given table as JSONB. '
  'Single source of truth for server-side state machine enforcement. '
  'Must stay in sync with the StateMachineConfig definitions in src/entities/ '
  '(batches: src/lib/schemas/batch.ts).';

-- =============================================================================
-- 2. GENERIC TRANSITION VALIDATOR  (restore 00143)
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
  v_old_status := OLD.status;
  v_new_status := NEW.status;

  IF v_old_status IS NOT DISTINCT FROM v_new_status THEN
    RETURN NEW;
  END IF;

  v_transitions := get_state_transitions(TG_TABLE_NAME);

  IF v_transitions IS NULL THEN
    -- No transition map registered for this table; allow anything.
    RETURN NEW;
  END IF;

  v_allowed := v_transitions -> v_old_status;

  IF v_allowed IS NULL THEN
    RAISE EXCEPTION 'Invalid current state "%" for table %', v_old_status, TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT v_allowed ? v_new_status THEN
    RAISE EXCEPTION 'Invalid state transition: % -> % (table: %). Allowed: %',
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
-- 3. ATTACH VALIDATION TRIGGERS  (restore 00143 — 8 stateful tables)
-- =============================================================================
DROP TRIGGER IF EXISTS trg_validate_batch_status ON batches;
CREATE TRIGGER trg_validate_batch_status
  BEFORE UPDATE OF status ON batches
  FOR EACH ROW EXECUTE FUNCTION validate_state_transition();

DROP TRIGGER IF EXISTS trg_validate_order_status ON orders;
CREATE TRIGGER trg_validate_order_status
  BEFORE UPDATE OF status ON orders
  FOR EACH ROW EXECUTE FUNCTION validate_state_transition();

DROP TRIGGER IF EXISTS trg_validate_po_status ON purchase_orders;
CREATE TRIGGER trg_validate_po_status
  BEFORE UPDATE OF status ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION validate_state_transition();

DROP TRIGGER IF EXISTS trg_validate_packaging_status ON packaging_sessions;
CREATE TRIGGER trg_validate_packaging_status
  BEFORE UPDATE OF status ON packaging_sessions
  FOR EACH ROW EXECUTE FUNCTION validate_state_transition();

DROP TRIGGER IF EXISTS trg_validate_brew_log_status ON brew_logs;
CREATE TRIGGER trg_validate_brew_log_status
  BEFORE UPDATE OF status ON brew_logs
  FOR EACH ROW EXECUTE FUNCTION validate_state_transition();

DROP TRIGGER IF EXISTS trg_validate_allocation_status ON allocations;
CREATE TRIGGER trg_validate_allocation_status
  BEFORE UPDATE OF status ON allocations
  FOR EACH ROW EXECUTE FUNCTION validate_state_transition();

DROP TRIGGER IF EXISTS trg_validate_pick_list_status ON pick_lists;
CREATE TRIGGER trg_validate_pick_list_status
  BEFORE UPDATE OF status ON pick_lists
  FOR EACH ROW EXECUTE FUNCTION validate_state_transition();

DROP TRIGGER IF EXISTS trg_validate_recipe_status ON recipes;
CREATE TRIGGER trg_validate_recipe_status
  BEFORE UPDATE OF status ON recipes
  FOR EACH ROW EXECUTE FUNCTION validate_state_transition();

-- =============================================================================
-- 4. PICK-LIST ALLOCATION LIFECYCLE  (restore 00108 + 00106)
-- =============================================================================
-- Cancel a pick list -> release its planned/pending FG reservations. Without
-- this, cancelling a pick list strands its `planned` allocations forever and
-- the reserved stock is invisibly unsellable (audit C2).
CREATE OR REPLACE FUNCTION cancel_pick_list_allocations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    UPDATE allocations
    SET status = 'cancelled'
    WHERE pick_list_item_id IN (
      SELECT id FROM pick_list_items WHERE pick_list_id = NEW.id
    )
    AND status IN ('planned', 'pending_approval');
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION cancel_pick_list_allocations IS
  'Cancels planned/pending allocations tied to a pick list when the pick list is cancelled.';

DROP TRIGGER IF EXISTS trg_cancel_pick_list_allocations ON pick_lists;
CREATE TRIGGER trg_cancel_pick_list_allocations
  AFTER UPDATE ON pick_lists
  FOR EACH ROW
  WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')
  EXECUTE FUNCTION cancel_pick_list_allocations();

-- Stamp started_at / completed_at when a pick list advances.
CREATE OR REPLACE FUNCTION set_pick_list_timestamps()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'in_progress' THEN
    NEW.started_at = NOW();
  END IF;

  IF NEW.status = 'completed' THEN
    NEW.completed_at = NOW();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pick_list_timestamps ON pick_lists;
CREATE TRIGGER trg_pick_list_timestamps
  BEFORE UPDATE ON pick_lists
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION set_pick_list_timestamps();

-- =============================================================================
-- 5. SEQUENTIAL-NUMBER SAFETY  (restore 00142 + 00075 advisory-lock bodies)
-- =============================================================================
-- Race-safe generator used by the lot/PO wrappers below. Live ran the pre-00142
-- bodies that did SELECT max()+1 with no lock -> duplicate numbers under
-- concurrency.
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
  v_lock_id := hashtext(p_table || '.' || p_column || '.' || COALESCE(p_prefix, ''));
  PERFORM pg_advisory_xact_lock(v_lock_id);

  IF p_prefix IS NOT NULL THEN
    v_pattern := p_prefix || '%';
  ELSE
    v_pattern := '%';
  END IF;

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

  EXECUTE v_sql INTO v_max_seq USING COALESCE(p_prefix, ''), v_pattern;
  v_next_seq := v_max_seq + 1;

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

-- PO number wrapper (app-used: src/domain/purchasing/po-generator.ts).
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

-- Lot number: advisory-lock version delegating to generate_next_number.
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

COMMENT ON FUNCTION generate_lot_number IS
  'Generates lot numbers in YYYYMMDD-NNN format, safe under concurrency. '
  'Delegates to generate_next_number() with advisory locking.';

-- Uniqueness backstop for lot numbers (00142). Guarded; live verified to hold
-- zero duplicate lot_number values on 2026-07-07, so ADD CONSTRAINT is clean.
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

-- Delivery number: advisory-lock version (00075). The trg_delivery_number
-- trigger already exists live and calls this function, so replacing the body
-- is sufficient.
CREATE OR REPLACE FUNCTION generate_delivery_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_date TEXT;
  v_seq INTEGER;
BEGIN
  v_date := TO_CHAR(COALESCE(NEW.scheduled_date, CURRENT_DATE), 'YYYYMMDD');

  -- Lock per-date to prevent concurrent duplicate numbers.
  PERFORM pg_advisory_xact_lock(hashtext('delivery_number_' || v_date));

  SELECT COALESCE(MAX(
    CAST(SUBSTRING(delivery_number FROM 'DEL-' || v_date || '-(\d+)') AS INTEGER)
  ), 0) + 1
  INTO v_seq
  FROM deliveries
  WHERE delivery_number LIKE 'DEL-' || v_date || '-%';

  NEW.delivery_number := 'DEL-' || v_date || '-' || LPAD(v_seq::TEXT, 3, '0');
  RETURN NEW;
END;
$$;

-- =============================================================================
-- 6. INGREDIENT SHORTFALLS  (restore 00150 — adds on_order_qty)
-- =============================================================================
-- Live ran the pre-00150 body whose TABLE signature lacks on_order_qty and
-- never subtracts confirmed-PO quantities, so the shortfalls page over-orders.
-- DROP first: CREATE OR REPLACE cannot change a function's return type, and the
-- live signature is the older on_order_qty-less RETURNS TABLE. No DB object
-- depends on it (RPC-only, called from the shortfalls page), so the drop is
-- safe; default PUBLIC EXECUTE is re-granted on the recreate.
DROP FUNCTION IF EXISTS calculate_ingredient_shortfalls(INTEGER);

CREATE FUNCTION calculate_ingredient_shortfalls(
  p_horizon_weeks INTEGER DEFAULT 8
)
RETURNS TABLE (
  catalog_type TEXT,
  catalog_id UUID,
  catalog_name TEXT,
  total_required DECIMAL(12,4),
  available_qty DECIMAL(12,4),
  on_order_qty DECIMAL(12,4),
  shortfall_qty DECIMAL(12,4),
  unit TEXT,
  required_by_date DATE,
  order_by_date DATE,
  lead_time_days INTEGER,
  preferred_supplier_id UUID,
  preferred_supplier_name TEXT,
  min_order_qty DECIMAL(10,2),
  unit_price DECIMAL(10,4),
  is_urgent BOOLEAN,
  batch_count INTEGER
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH demand AS (
    SELECT * FROM calculate_ingredient_demand(p_horizon_weeks, true, true)
  ),
  inventory_available AS (
    SELECT
      CASE ii.category
        WHEN 'grain' THEN 'malt'
        WHEN 'hops' THEN 'hop'
        WHEN 'yeast' THEN 'yeast'
        WHEN 'adjunct' THEN 'adjunct'
        ELSE ii.category
      END as inferred_catalog_type,
      ii.name as item_name,
      COALESCE(SUM(ilq.remaining_quantity), 0) as available_qty
    FROM inventory_items ii
    LEFT JOIN inventory_lots_with_quantities ilq ON ilq.inventory_item_id = ii.id
    WHERE ii.is_active = true
    GROUP BY ii.category, ii.name
  ),
  po_received_summary AS (
    SELECT pr.po_line_item_id, SUM(pr.quantity) as received_qty
    FROM po_receives pr
    GROUP BY pr.po_line_item_id
  ),
  confirmed_po_quantities AS (
    SELECT
      pli.catalog_type,
      pli.catalog_id,
      COALESCE(
        SUM(pli.quantity - COALESCE(prs.received_qty, 0)),
        0
      ) as on_order_qty
    FROM po_line_items pli
    JOIN purchase_orders po ON po.id = pli.po_id
    LEFT JOIN po_received_summary prs ON prs.po_line_item_id = pli.id
    WHERE po.status IN ('confirmed', 'partial', 'fulfilled')
    GROUP BY pli.catalog_type, pli.catalog_id
  ),
  preferred_suppliers AS (
    SELECT DISTINCT ON (sc.catalog_type, sc.catalog_id)
      sc.catalog_type,
      sc.catalog_id,
      sc.supplier_id,
      s.name as supplier_name,
      COALESCE(sc.lead_time_days, s.default_lead_time_days, 7) as lead_time_days,
      sc.min_order_qty,
      sc.price as unit_price
    FROM supplier_catalog sc
    JOIN suppliers s ON s.id = sc.supplier_id
    WHERE sc.is_preferred = true
       OR sc.id IN (
         SELECT sc2.id
         FROM supplier_catalog sc2
         WHERE sc2.catalog_type = sc.catalog_type
           AND sc2.catalog_id = sc.catalog_id
         ORDER BY sc2.price ASC NULLS LAST
         LIMIT 1
       )
    ORDER BY sc.catalog_type, sc.catalog_id, sc.is_preferred DESC, sc.price ASC
  )
  SELECT
    d.catalog_type,
    d.catalog_id,
    d.catalog_name,
    d.total_required,
    COALESCE(ia.available_qty, 0)::DECIMAL(12,4) as available_qty,
    COALESCE(cpq.on_order_qty, 0)::DECIMAL(12,4) as on_order_qty,
    GREATEST(
      d.total_required - COALESCE(ia.available_qty, 0) - COALESCE(cpq.on_order_qty, 0),
      0
    )::DECIMAL(12,4) as shortfall_qty,
    d.unit,
    d.earliest_required_by as required_by_date,
    (d.earliest_required_by - COALESCE(ps.lead_time_days, 7) - 3)::DATE as order_by_date,
    COALESCE(ps.lead_time_days, 7)::INTEGER as lead_time_days,
    ps.supplier_id as preferred_supplier_id,
    ps.supplier_name as preferred_supplier_name,
    ps.min_order_qty,
    ps.unit_price,
    ((d.earliest_required_by - COALESCE(ps.lead_time_days, 7) - 3) <= (CURRENT_DATE + 3))::BOOLEAN as is_urgent,
    d.batch_count
  FROM demand d
  LEFT JOIN inventory_available ia
    ON ia.item_name ILIKE d.catalog_name
    AND ia.inferred_catalog_type = d.catalog_type
  LEFT JOIN confirmed_po_quantities cpq
    ON cpq.catalog_type = d.catalog_type
    AND cpq.catalog_id = d.catalog_id
  LEFT JOIN preferred_suppliers ps
    ON ps.catalog_type = d.catalog_type
    AND ps.catalog_id = d.catalog_id
  WHERE d.total_required > (COALESCE(ia.available_qty, 0) + COALESCE(cpq.on_order_qty, 0))
  ORDER BY is_urgent DESC, order_by_date ASC, d.catalog_type, d.total_required DESC;
END;
$$;

COMMENT ON FUNCTION calculate_ingredient_shortfalls(INTEGER) IS
  'Calculates ingredient shortfalls for upcoming batches within the given horizon. '
  'Lead time cascades: supplier_catalog.lead_time_days -> suppliers.default_lead_time_days -> 7 day fallback. '
  'Subtracts outstanding confirmed-PO quantities (on_order_qty).';

-- =============================================================================
-- 7. OTHER APP-USED FUNCTIONS DROPPED IN THE SAME DRIFT  (restore verbatim)
-- =============================================================================
-- Yeast lineage root walk (app-used: src/domain/yeast-lineage.ts). Columns
-- yeast_pitches.{id,parent_pitch_id} verified present on live.
CREATE OR REPLACE FUNCTION get_yeast_lineage_root(p_pitch_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH RECURSIVE lineage AS (
    SELECT id, parent_pitch_id
    FROM yeast_pitches
    WHERE id = p_pitch_id

    UNION ALL

    SELECT yp.id, yp.parent_pitch_id
    FROM yeast_pitches yp
    JOIN lineage l ON l.parent_pitch_id = yp.id
  )
  SELECT id FROM lineage WHERE parent_pitch_id IS NULL LIMIT 1;
$$;

COMMENT ON FUNCTION get_yeast_lineage_root IS
  'Walks up the yeast pitch parent chain via recursive CTE and returns the root pitch ID (the original purchase with no parent).';

-- Unaccepted PO receives (app-used: po-accept-inventory-dialog.tsx). Columns
-- po_line_items.{catalog_type,catalog_id,unit,unit_price,po_id},
-- po_receives.*, inventory_lots.po_receive_id verified present on live.
CREATE OR REPLACE FUNCTION get_unaccepted_po_receives(p_po_id UUID)
RETURNS TABLE (
  receive_id UUID,
  po_line_item_id UUID,
  catalog_type TEXT,
  catalog_id TEXT,
  quantity DECIMAL,
  unit TEXT,
  unit_price DECIMAL,
  lot_number TEXT,
  expiration_date DATE,
  received_date DATE
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    pr.id AS receive_id,
    pr.po_line_item_id,
    pli.catalog_type,
    pli.catalog_id,
    pr.quantity,
    pli.unit,
    pli.unit_price,
    pr.lot_number,
    pr.expiration_date,
    pr.received_date
  FROM po_receives pr
  JOIN po_line_items pli ON pli.id = pr.po_line_item_id
  WHERE pli.po_id = p_po_id
    AND NOT EXISTS (
      SELECT 1 FROM inventory_lots il
      WHERE il.po_receive_id = pr.id
    );
$$;

COMMENT ON FUNCTION get_unaccepted_po_receives IS
  'Returns po_receives for a PO that have no linked inventory_lot yet (used by the Accept into Inventory dialog).';

-- Make the restored functions visible to PostgREST immediately.
NOTIFY pgrst, 'reload schema';
