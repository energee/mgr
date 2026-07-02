-- =============================================================================
-- 00190 - capture out-of-band live objects (audit #10)
-- =============================================================================
-- These objects existed on the live DB (project phwjrfdtebftetctkhdr) but had
-- no CREATE in any migration, so the schema was not recreatable from
-- migrations. Captured verbatim from the live catalog (pg_get_functiondef /
-- pg_get_viewdef / pg_get_triggerdef); idempotent, no behavior change.
--   functions: dispatch_email_notification, get_inventory_trends,
--              get_production_trends, get_sales_trends, record_keg_transaction,
--              set_keg_transaction_states
--   views:     batch_yeast_summary, order_items_with_details, orders_with_totals,
--              pricing_formats, vessel_batch_drift_check  (all security_invoker)
--   triggers:  set_keg_transaction_states_trigger, set_containers_updated_at,
--              set_selling_formats_updated_at, update_email_settings_updated_at
-- =============================================================================

-- Functions ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.dispatch_email_notification(p_user_id uuid, p_type text, p_title text, p_message text, p_priority text, p_action_url text, p_metadata jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_email_settings RECORD;
  v_prefs RECORD;
  v_user_email TEXT;
  v_log_id UUID;
  v_edge_fn_url TEXT;
  v_service_role_key TEXT;
  v_email_subject TEXT;
  v_email_html TEXT;
  v_email_text TEXT;
  v_app_url TEXT;
BEGIN
  SELECT is_enabled, supabase_project_url, app_url
    INTO v_email_settings
    FROM email_settings
    LIMIT 1;

  IF NOT FOUND OR NOT v_email_settings.is_enabled THEN
    RETURN;
  END IF;

  IF v_email_settings.supabase_project_url IS NULL OR v_email_settings.supabase_project_url = '' THEN
    RETURN;
  END IF;

  SELECT email_enabled
    INTO v_prefs
    FROM notification_preferences
    WHERE user_id = p_user_id;

  IF NOT FOUND OR NOT v_prefs.email_enabled THEN
    RETURN;
  END IF;

  SELECT email INTO v_user_email
    FROM user_profiles
    WHERE id = p_user_id AND status = 'active';

  IF v_user_email IS NULL OR v_user_email = '' THEN
    RETURN;
  END IF;

  v_email_subject := p_title;
  v_app_url := COALESCE(v_email_settings.app_url, '');

  v_email_html := '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;">'
    || '<h2 style="color:#111827;">' || p_title || '</h2>'
    || CASE WHEN p_message IS NOT NULL
         THEN '<p style="color:#374151;line-height:1.6;">' || p_message || '</p>'
         ELSE ''
       END
    || CASE WHEN p_action_url IS NOT NULL AND v_app_url != ''
         THEN '<p style="margin-top:16px;"><a href="' || v_app_url || p_action_url
              || '" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;'
              || 'text-decoration:none;border-radius:6px;">View Details</a></p>'
         ELSE ''
       END
    || '<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />'
    || '<p style="color:#6b7280;font-size:12px;">'
    || 'You received this because email notifications are enabled. '
    || CASE WHEN v_app_url != ''
         THEN '<a href="' || v_app_url || '/settings/notifications">Manage preferences</a>'
         ELSE 'Manage preferences in your account settings.'
       END
    || '</p></div>';

  v_email_text := p_title || E'\n\n'
    || COALESCE(p_message, '') || E'\n\n'
    || CASE WHEN p_action_url IS NOT NULL AND v_app_url != ''
         THEN 'View: ' || v_app_url || p_action_url || E'\n\n'
         ELSE ''
       END
    || '---' || E'\n'
    || 'Manage notification preferences: '
    || CASE WHEN v_app_url != ''
         THEN v_app_url || '/settings/notifications'
         ELSE 'your account settings'
       END;

  INSERT INTO email_notification_log (user_id, notification_type, recipient_email, subject, status)
  VALUES (p_user_id, p_type, v_user_email, v_email_subject, 'pending')
  RETURNING id INTO v_log_id;

  v_edge_fn_url := v_email_settings.supabase_project_url || '/functions/v1/send-email';

  v_service_role_key := current_setting('app.settings.service_role_key', true);

  IF v_service_role_key IS NULL OR v_service_role_key = '' THEN
    BEGIN
      SELECT decrypted_secret INTO v_service_role_key
        FROM vault.decrypted_secrets
        WHERE name = 'service_role_key'
        LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE email_notification_log
        SET status = 'skipped', error_message = 'No service_role_key available for Edge Function auth'
        WHERE id = v_log_id;
      RETURN;
    END;

    IF v_service_role_key IS NULL OR v_service_role_key = '' THEN
      UPDATE email_notification_log
        SET status = 'skipped', error_message = 'service_role_key not found in vault or app.settings'
        WHERE id = v_log_id;
      RETURN;
    END IF;
  END IF;

  PERFORM net.http_post(
    url := v_edge_fn_url,
    body := jsonb_build_object(
      'to', v_user_email,
      'subject', v_email_subject,
      'html', v_email_html,
      'text', v_email_text
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_role_key
    )
  );

END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_inventory_trends(p_days integer DEFAULT 30)
 RETURNS TABLE(date date, lots_created integer, lots_depleted integer, total_lot_activity integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH date_series AS (
    SELECT generate_series(
      CURRENT_DATE - (p_days * 2 - 1),
      CURRENT_DATE,
      '1 day'::interval
    )::date AS date
  ),
  created AS (
    SELECT
      created_at::date AS date,
      COUNT(*)::integer AS cnt
    FROM inventory_lots
    WHERE created_at >= CURRENT_DATE - (p_days * 2 - 1)
    GROUP BY created_at::date
  ),
  depleted AS (
    SELECT
      updated_at::date AS date,
      COUNT(*)::integer AS cnt
    FROM inventory_lots
    WHERE quantity <= 0
      AND updated_at >= CURRENT_DATE - (p_days * 2 - 1)
      AND updated_at != created_at
    GROUP BY updated_at::date
  )
  SELECT
    ds.date,
    COALESCE(cr.cnt, 0)::integer AS lots_created,
    COALESCE(dp.cnt, 0)::integer AS lots_depleted,
    (COALESCE(cr.cnt, 0) + COALESCE(dp.cnt, 0))::integer AS total_lot_activity
  FROM date_series ds
  LEFT JOIN created cr ON cr.date = ds.date
  LEFT JOIN depleted dp ON dp.date = ds.date
  ORDER BY ds.date;
$function$
;

CREATE OR REPLACE FUNCTION public.get_production_trends(p_days integer DEFAULT 30)
 RETURNS TABLE(date date, batches_started integer, volume_bbl numeric, batches_completed integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH date_series AS (
    SELECT generate_series(
      CURRENT_DATE - (p_days * 2 - 1),
      CURRENT_DATE,
      '1 day'::interval
    )::date AS date
  ),
  starts AS (
    SELECT
      planned_start_date AS date,
      COUNT(*)::integer AS cnt,
      COALESCE(SUM(volume_bbl), 0) AS vol
    FROM batches
    WHERE planned_start_date >= CURRENT_DATE - (p_days * 2 - 1)
      AND planned_start_date IS NOT NULL
    GROUP BY planned_start_date
  ),
  completions AS (
    SELECT
      updated_at::date AS date,
      COUNT(*)::integer AS cnt
    FROM batches
    WHERE status = 'completed'
      AND updated_at >= CURRENT_DATE - (p_days * 2 - 1)
    GROUP BY updated_at::date
  )
  SELECT
    ds.date,
    COALESCE(s.cnt, 0)::integer AS batches_started,
    COALESCE(s.vol, 0)::numeric AS volume_bbl,
    COALESCE(c.cnt, 0)::integer AS batches_completed
  FROM date_series ds
  LEFT JOIN starts s ON s.date = ds.date
  LEFT JOIN completions c ON c.date = ds.date
  ORDER BY ds.date;
$function$
;

CREATE OR REPLACE FUNCTION public.get_sales_trends(p_days integer DEFAULT 30)
 RETURNS TABLE(date date, order_count integer, revenue numeric, fulfilled_count integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH date_series AS (
    SELECT generate_series(
      CURRENT_DATE - (p_days * 2 - 1),
      CURRENT_DATE,
      '1 day'::interval
    )::date AS date
  ),
  daily_orders AS (
    SELECT
      o.order_date AS date,
      COUNT(*)::integer AS cnt,
      COALESCE(SUM(oi_totals.total), 0) AS rev
    FROM orders o
    LEFT JOIN (
      SELECT order_id, SUM(quantity * unit_price) AS total
      FROM order_items
      GROUP BY order_id
    ) oi_totals ON oi_totals.order_id = o.id
    WHERE o.order_date >= CURRENT_DATE - (p_days * 2 - 1)
      AND o.status != 'cancelled'
    GROUP BY o.order_date
  ),
  daily_fulfilled AS (
    SELECT
      updated_at::date AS date,
      COUNT(*)::integer AS cnt
    FROM orders
    WHERE status = 'fulfilled'
      AND updated_at >= CURRENT_DATE - (p_days * 2 - 1)
    GROUP BY updated_at::date
  )
  SELECT
    ds.date,
    COALESCE(do2.cnt, 0)::integer AS order_count,
    COALESCE(do2.rev, 0)::numeric AS revenue,
    COALESCE(df.cnt, 0)::integer AS fulfilled_count
  FROM date_series ds
  LEFT JOIN daily_orders do2 ON do2.date = ds.date
  LEFT JOIN daily_fulfilled df ON df.date = ds.date
  ORDER BY ds.date;
$function$
;

CREATE OR REPLACE FUNCTION public.record_keg_transaction(p_transaction_type keg_transaction_type, p_selling_format_id uuid, p_quantity integer, p_from_state keg_state, p_to_state keg_state, p_from_location_id uuid DEFAULT NULL::uuid, p_to_location_id uuid DEFAULT NULL::uuid, p_order_id uuid DEFAULT NULL::uuid, p_customer_id uuid DEFAULT NULL::uuid, p_packaging_session_id uuid DEFAULT NULL::uuid, p_batch_id uuid DEFAULT NULL::uuid, p_finished_good_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text, p_created_by_name text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_transaction_id UUID;
BEGIN
  INSERT INTO keg_transactions (
    transaction_type, selling_format_id, quantity,
    from_state, to_state,
    from_location_id, to_location_id,
    order_id, customer_id, packaging_session_id,
    batch_id, finished_good_id,
    notes, created_by_name
  ) VALUES (
    p_transaction_type, p_selling_format_id, p_quantity,
    p_from_state, p_to_state,
    p_from_location_id, p_to_location_id,
    p_order_id, p_customer_id, p_packaging_session_id,
    p_batch_id, p_finished_good_id,
    p_notes, p_created_by_name
  )
  RETURNING id INTO v_transaction_id;

  RETURN v_transaction_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_keg_transaction_states()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  CASE NEW.transaction_type
    WHEN 'receive' THEN
      NEW.from_state := NULL;
      NEW.to_state := 'empty';
    WHEN 'fill' THEN
      NEW.from_state := 'empty';
      NEW.to_state := 'filled';
    WHEN 'ship' THEN
      NEW.from_state := 'filled';
      NEW.to_state := 'shipped';
    WHEN 'return' THEN
      NEW.from_state := 'shipped';
      NEW.to_state := 'returned_dirty';
    WHEN 'clean' THEN
      NEW.from_state := COALESCE(NEW.from_state, 'returned_dirty');
      NEW.to_state := COALESCE(NEW.to_state, 'empty');
    WHEN 'maintain' THEN
      NEW.to_state := 'maintenance';
    WHEN 'retire' THEN
      NEW.to_state := 'retired';
    WHEN 'adjust' THEN
      -- adjust: use provided values or default to_state = 'empty'
      NEW.to_state := COALESCE(NEW.to_state, 'empty');
    ELSE
      NULL; -- no-op for unknown types (constraint will catch)
  END CASE;

  RETURN NEW;
END;
$function$
;

-- Views ----------------------------------------------------------------------

CREATE OR REPLACE VIEW public.batch_yeast_summary
WITH (security_invoker = true) AS
 SELECT e.batch_id,
    e.id AS event_id,
    e.pitch_id,
    e.quantity_lbs,
    e.cells_pitched_thousand,
    e.viability_at_pitch,
    e.pitched_at,
    e.notes,
    yp.strain_id,
    yp.generation,
    yp.source_type,
    y.name AS strain_name,
    y.manufacturer AS strain_manufacturer,
    y.product_code AS strain_code,
    y.type AS strain_type,
    y.form AS strain_form
   FROM yeast_pitch_events e
     JOIN yeast_pitches yp ON e.pitch_id = yp.id
     JOIN yeasts y ON yp.strain_id = y.id;;

CREATE OR REPLACE VIEW public.order_items_with_details
WITH (security_invoker = true) AS
 SELECT oi.id,
    oi.order_id,
    oi.package_id,
    oi.batch_id,
    oi.selling_format_id,
    oi.quantity,
    oi.unit_price,
    oi.notes,
    oi.created_at,
    oi.brand_id,
    b.name AS brand_name,
    b.abv AS brand_abv,
    sf.name AS selling_format_name,
    c.type AS container_type,
    c.volume_oz,
    sf.unit_count,
    c.name AS container_name,
    oi.quantity::numeric * COALESCE(oi.unit_price, 0::numeric) AS line_total
   FROM order_items oi
     LEFT JOIN brands b ON b.id = oi.brand_id
     LEFT JOIN selling_formats sf ON sf.id = oi.selling_format_id
     LEFT JOIN containers c ON c.id = sf.container_id;;

CREATE OR REPLACE VIEW public.orders_with_totals
WITH (security_invoker = true) AS
 SELECT o.id,
    o.customer_id,
    o.order_number,
    o.status,
    o.order_date,
    o.requested_date,
    o.scheduled_date,
    o.fulfilled_date,
    o.shipping_address,
    o.notes,
    o.created_at,
    o.updated_at,
    c.name AS customer_name,
    COALESCE(sum(oi.quantity::numeric * COALESCE(oi.unit_price, 0::numeric)), 0::numeric) AS order_total,
    COALESCE(sum(oi.quantity), 0::bigint) AS total_units,
    count(oi.id) AS line_count
   FROM orders o
     LEFT JOIN customers c ON c.id = o.customer_id
     LEFT JOIN order_items oi ON oi.order_id = o.id
  GROUP BY o.id, c.name;;

CREATE OR REPLACE VIEW public.pricing_formats
WITH (security_invoker = true) AS
 SELECT sf.id,
    sf.name,
    c.type AS container_type,
        CASE c.type
            WHEN 'keg'::text THEN 'keg_type'::text
            ELSE 'package_type'::text
        END AS format_source,
        CASE c.type
            WHEN 'keg'::text THEN 2
            ELSE 1
        END AS sort_group
   FROM selling_formats sf
     JOIN containers c ON c.id = sf.container_id
  WHERE sf.is_active = true AND c.is_active = true;;

CREATE OR REPLACE VIEW public.vessel_batch_drift_check
WITH (security_invoker = true) AS
 WITH latest_transfers AS (
         SELECT DISTINCT ON (vessel_transfers.to_vessel_id) vessel_transfers.to_vessel_id AS vessel_id,
            vessel_transfers.batch_id,
            vessel_transfers.transferred_at
           FROM vessel_transfers
          ORDER BY vessel_transfers.to_vessel_id, vessel_transfers.transferred_at DESC
        ), latest_outbound AS (
         SELECT DISTINCT ON (vessel_transfers.from_vessel_id) vessel_transfers.from_vessel_id AS vessel_id,
            vessel_transfers.transferred_at
           FROM vessel_transfers
          WHERE vessel_transfers.from_vessel_id IS NOT NULL
          ORDER BY vessel_transfers.from_vessel_id, vessel_transfers.transferred_at DESC
        )
 SELECT v.id AS vessel_id,
    v.name AS vessel_name,
    v.current_batch_id AS stored_batch_id,
        CASE
            WHEN lo.transferred_at > lt.transferred_at THEN NULL::uuid
            ELSE lt.batch_id
        END AS expected_batch_id,
    b_stored.batch_code AS stored_batch_number,
    b_expected.batch_code AS expected_batch_number,
    lt.transferred_at AS last_inbound_at,
    lo.transferred_at AS last_outbound_at
   FROM vessels v
     LEFT JOIN latest_transfers lt ON lt.vessel_id = v.id
     LEFT JOIN latest_outbound lo ON lo.vessel_id = v.id
     LEFT JOIN batches b_stored ON b_stored.id = v.current_batch_id
     LEFT JOIN batches b_expected ON b_expected.id =
        CASE
            WHEN lo.transferred_at > lt.transferred_at THEN NULL::uuid
            ELSE lt.batch_id
        END
  WHERE v.current_batch_id IS DISTINCT FROM
        CASE
            WHEN lo.transferred_at > lt.transferred_at THEN NULL::uuid
            ELSE lt.batch_id
        END;;

-- Triggers -------------------------------------------------------------------

DROP TRIGGER IF EXISTS set_containers_updated_at ON public.containers;
CREATE TRIGGER set_containers_updated_at BEFORE UPDATE ON public.containers FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS set_keg_transaction_states_trigger ON public.keg_transactions;
CREATE TRIGGER set_keg_transaction_states_trigger BEFORE INSERT ON public.keg_transactions FOR EACH ROW EXECUTE FUNCTION set_keg_transaction_states();

DROP TRIGGER IF EXISTS set_selling_formats_updated_at ON public.selling_formats;
CREATE TRIGGER set_selling_formats_updated_at BEFORE UPDATE ON public.selling_formats FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_email_settings_updated_at ON public.email_settings;
CREATE TRIGGER update_email_settings_updated_at BEFORE UPDATE ON public.email_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at();

NOTIFY pgrst, 'reload schema';
