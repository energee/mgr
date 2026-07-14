-- Audited, non-destructive Beer Orders spreadsheet reconciliation.
--
-- Preview plans are authored by the permission-gated server route and stored before apply.
-- apply_beer_order_import locks one preview and applies all customer, mapping, order, and
-- line-item changes in one transaction. Spreadsheet orders absent from the plan are never
-- deleted. Existing order lifecycle statuses are never changed.

CREATE TABLE beer_order_import_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL,
  file_sha256 TEXT NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL DEFAULT 'previewed'
    CHECK (status IN ('previewed', 'applied', 'failed')),
  plan JSONB NOT NULL,
  summary JSONB NOT NULL,
  error TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at TIMESTAMPTZ
);

CREATE INDEX idx_beer_order_import_runs_created_at
  ON beer_order_import_runs(created_at DESC);

COMMENT ON TABLE beer_order_import_runs IS
  'Audit log and immutable server-authored plans for Beer Orders spreadsheet reconciliation.';

CREATE TABLE beer_order_customer_mappings (
  source_key TEXT PRIMARY KEY,
  source_label TEXT NOT NULL,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE beer_order_customer_mappings IS
  'Saved normalized spreadsheet customer labels mapped to MGR customers.';

CREATE TABLE beer_order_brand_mappings (
  source_key TEXT PRIMARY KEY,
  source_label TEXT NOT NULL,
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE RESTRICT,
  distributor_tier SMALLINT CHECK (distributor_tier BETWEEN 1 AND 7),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE beer_order_brand_mappings IS
  'Saved normalized spreadsheet beer labels mapped to MGR brands and default Distributor tiers.';

ALTER TABLE beer_order_import_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE beer_order_customer_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE beer_order_brand_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY beer_order_import_runs_read ON beer_order_import_runs
  FOR SELECT
  USING (user_has_permission('integrations:manage'));

CREATE POLICY beer_order_customer_mappings_read ON beer_order_customer_mappings
  FOR SELECT
  USING (user_has_permission('integrations:manage'));

CREATE POLICY beer_order_brand_mappings_read ON beer_order_brand_mappings
  FOR SELECT
  USING (user_has_permission('integrations:manage'));

CREATE OR REPLACE FUNCTION apply_beer_order_import(p_run_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
  v_plan JSONB;
  v_summary JSONB;
  v_customer JSONB;
  v_mapping JSONB;
  v_order JSONB;
  v_item JSONB;
BEGIN
  SELECT status, plan, summary
  INTO v_status, v_plan, v_summary
  FROM beer_order_import_runs
  WHERE id = p_run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Beer order import run % not found', p_run_id
      USING ERRCODE = 'no_data_found';
  END IF;
  IF v_status <> 'previewed' THEN
    RAISE EXCEPTION 'Beer order import run % is %, not previewed', p_run_id, v_status
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF COALESCE((v_plan ->> 'version')::INTEGER, 0) <> 1
     OR COALESCE((v_plan ->> 'ready')::BOOLEAN, FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Beer order import run % does not contain an apply-ready version 1 plan', p_run_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF COALESCE(jsonb_array_length(v_plan #> '{unresolved,customers}'), 0) > 0
     OR COALESCE(jsonb_array_length(v_plan #> '{unresolved,brands}'), 0) > 0 THEN
    RAISE EXCEPTION 'Beer order import run % still has unresolved mappings', p_run_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  FOR v_customer IN
    SELECT value FROM jsonb_array_elements(v_plan -> 'customersToCreate')
  LOOP
    INSERT INTO customers (
      id, name, customer_type, sales_channel_id, price_tier_id, is_active, notes
    ) VALUES (
      (v_customer ->> 'id')::UUID,
      v_customer ->> 'name',
      v_customer ->> 'customerType',
      (v_customer ->> 'salesChannelId')::UUID,
      NULLIF(v_customer ->> 'priceTierId', '')::UUID,
      COALESCE((v_customer ->> 'isActive')::BOOLEAN, TRUE),
      v_customer ->> 'notes'
    )
    ON CONFLICT (id) DO NOTHING;
  END LOOP;

  FOR v_mapping IN
    SELECT value FROM jsonb_array_elements(v_plan -> 'customerMappings')
  LOOP
    INSERT INTO beer_order_customer_mappings (
      source_key, source_label, customer_id
    ) VALUES (
      v_mapping ->> 'sourceKey',
      v_mapping ->> 'sourceLabel',
      (v_mapping ->> 'customerId')::UUID
    )
    ON CONFLICT (source_key) DO UPDATE SET
      source_label = EXCLUDED.source_label,
      customer_id = EXCLUDED.customer_id,
      updated_at = NOW();
  END LOOP;

  FOR v_mapping IN
    SELECT value FROM jsonb_array_elements(v_plan -> 'brandMappings')
  LOOP
    INSERT INTO beer_order_brand_mappings (
      source_key, source_label, brand_id, distributor_tier
    ) VALUES (
      v_mapping ->> 'sourceKey',
      v_mapping ->> 'sourceLabel',
      (v_mapping ->> 'brandId')::UUID,
      NULLIF(v_mapping ->> 'distributorTier', '')::SMALLINT
    )
    ON CONFLICT (source_key) DO UPDATE SET
      source_label = EXCLUDED.source_label,
      brand_id = EXCLUDED.brand_id,
      distributor_tier = EXCLUDED.distributor_tier,
      updated_at = NOW();
  END LOOP;

  FOR v_order IN
    SELECT value FROM jsonb_array_elements(v_plan -> 'orders')
  LOOP
    -- Unchanged orders are deliberately untouched so versions and downstream references
    -- remain stable across a no-op reimport.
    IF v_order ->> 'change' = 'unchanged' THEN
      CONTINUE;
    END IF;

    INSERT INTO orders (
      id, order_number, customer_id, status, order_date, requested_date, notes, is_export
    ) VALUES (
      (v_order ->> 'id')::UUID,
      v_order ->> 'orderNumber',
      (v_order ->> 'customerId')::UUID,
      'draft',
      (v_order ->> 'orderDate')::DATE,
      NULLIF(v_order ->> 'requestedDate', '')::DATE,
      v_order ->> 'notes',
      (v_order ->> 'isExport')::BOOLEAN
    )
    ON CONFLICT (id) DO UPDATE SET
      customer_id = EXCLUDED.customer_id,
      order_date = EXCLUDED.order_date,
      requested_date = EXCLUDED.requested_date,
      notes = EXCLUDED.notes,
      is_export = EXCLUDED.is_export,
      updated_at = NOW(),
      version = orders.version + 1;

    FOR v_item IN
      SELECT value FROM jsonb_array_elements(v_order -> 'lines')
    LOOP
      INSERT INTO order_items (
        id, order_id, brand_id, selling_format_id, quantity,
        unit_price, keg_owner_id, notes
      ) VALUES (
        (v_item ->> 'id')::UUID,
        (v_item ->> 'orderId')::UUID,
        (v_item ->> 'brandId')::UUID,
        (v_item ->> 'sellingFormatId')::UUID,
        (v_item ->> 'quantity')::INTEGER,
        (v_item ->> 'unitPrice')::NUMERIC(10, 2),
        NULLIF(v_item ->> 'kegOwnerId', '')::UUID,
        v_item ->> 'notes'
      )
      ON CONFLICT (id) DO UPDATE SET
        brand_id = EXCLUDED.brand_id,
        selling_format_id = EXCLUDED.selling_format_id,
        quantity = EXCLUDED.quantity,
        unit_price = EXCLUDED.unit_price,
        keg_owner_id = EXCLUDED.keg_owner_id,
        notes = EXCLUDED.notes;
    END LOOP;

    -- Only lines absent from this spreadsheet order are removed. Stable deterministic line
    -- IDs are updated in place, preserving pick-list references whenever the line remains.
    DELETE FROM order_items oi
    WHERE oi.order_id = (v_order ->> 'id')::UUID
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_order -> 'lines') AS planned(value)
        WHERE (planned.value ->> 'id')::UUID = oi.id
      );
  END LOOP;

  UPDATE beer_order_import_runs
  SET status = 'applied', applied_at = NOW(), error = NULL
  WHERE id = p_run_id;

  RETURN v_summary;
END;
$$;

COMMENT ON FUNCTION apply_beer_order_import(UUID) IS
  'Atomically applies one server-authored Beer Orders preview. Preserves existing order '
  'statuses, updates stable order-item IDs in place, and never deletes stale orders.';

-- The permission-gated API invokes this RPC with the service role. Keeping direct
-- authenticated execution disabled ensures every applied plan was authored by that API.
REVOKE ALL ON FUNCTION apply_beer_order_import(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION apply_beer_order_import(UUID) TO service_role;

INSERT INTO _schema_registry (
  table_name, description, domain, relationships, key_fields, query_examples
) VALUES
  (
    'beer_order_import_runs',
    'Audited preview and apply runs for Beer Orders spreadsheet reconciliation',
    'sales',
    '[{"table":"auth.users","type":"many-to-one","column":"created_by"}]'::jsonb,
    '["filename","file_sha256","status","created_at"]'::jsonb,
    '["SELECT filename, status, summary, created_at, applied_at FROM beer_order_import_runs ORDER BY created_at DESC LIMIT 20"]'::jsonb
  ),
  (
    'beer_order_customer_mappings',
    'Normalized Beer Orders customer labels mapped to MGR customers',
    'sales',
    '[{"table":"customers","type":"many-to-one","column":"customer_id"}]'::jsonb,
    '["source_key","customer_id"]'::jsonb,
    '["SELECT source_label, customer_id FROM beer_order_customer_mappings ORDER BY source_label"]'::jsonb
  ),
  (
    'beer_order_brand_mappings',
    'Normalized Beer Orders beer labels mapped to MGR brands and Distributor tiers',
    'sales',
    '[{"table":"brands","type":"many-to-one","column":"brand_id"}]'::jsonb,
    '["source_key","brand_id","distributor_tier"]'::jsonb,
    '["SELECT source_label, brand_id, distributor_tier FROM beer_order_brand_mappings ORDER BY source_label"]'::jsonb
  )
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships,
  key_fields = EXCLUDED.key_fields,
  query_examples = EXCLUDED.query_examples;
