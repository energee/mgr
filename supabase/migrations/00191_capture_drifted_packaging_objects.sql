-- =============================================================================
-- 00191 - capture drifted packaging-model objects (audit #10)
-- =============================================================================
-- These 18 views + 5 functions exist on the live DB (project phwjrfdtebftetctkhdr)
-- with definitions that DRIFTED from the definitions a fresh `supabase db reset`
-- would build from the migration history.
--
-- Root cause: the packaging-formats refactor (package_types/keg_types ->
-- selling_formats/containers) was applied to LIVE, but its migration was lost in
-- the 00112-00135 squash/renumber gap. The surviving migrations still define the
-- OLD packaging model, so reset reproduces stale definitions. Captured here
-- verbatim from the live catalog (pg_get_viewdef / pg_get_functiondef), in
-- dependency order, security_invoker preserved. Idempotent (CREATE OR REPLACE);
-- a no-op against live; byte-verified (body md5 e6fccf4f592a2d069d4a5273e3057bad).
--
-- SCOPE / KNOWN GAP: this captures the DERIVED-object layer only. It does NOT by
-- itself make `db reset` reproduce live: the selling_formats/containers TABLES
-- have no CREATE in any migration (lost in the same squash), so a fresh reset
-- still fails earlier (~00160, first hard FK to selling_formats). The table-level
-- reconstruction + legacy-table drop is tracked in
-- docs/plans/2026-06-30-migration-reconciliation-10.md and must be validated with
-- an actual `db reset` in a Docker-equipped environment.
--
--   views (dependency order):
--     keg_inventory, keg_inventory_summary, keg_turnover_metrics, bin_contents,
--     customer_keg_balances, customer_keg_balance_summary, keg_aging_report,
--     customer_keg_transaction_history, finished_goods_with_availability,
--     finished_goods_supply_by_product, finished_goods_with_ttb_class,
--     order_demand_by_product, packaging_formats, recipe_ingredients_normalized,
--     recipes_with_estimates, yeast_lineage_summary, yeast_pitches_with_remaining,
--     customers_with_order_summary
--   functions:
--     calculate_production_shortfalls, get_ttb_inventory_summary,
--     get_ttb_production_summary, get_ttb_removals_summary, notify_all_users
-- =============================================================================

CREATE OR REPLACE VIEW public.keg_inventory
WITH (security_invoker = true) AS
 WITH inflows AS (
         SELECT keg_transactions.selling_format_id,
            keg_transactions.keg_owner_id,
            keg_transactions.to_state AS state,
            keg_transactions.to_location_id AS location_id,
            keg_transactions.batch_id,
            keg_transactions.finished_good_id,
            sum(keg_transactions.quantity) AS qty
           FROM keg_transactions
          GROUP BY keg_transactions.selling_format_id, keg_transactions.keg_owner_id, keg_transactions.to_state, keg_transactions.to_location_id, keg_transactions.batch_id, keg_transactions.finished_good_id
        ), outflows AS (
         SELECT keg_transactions.selling_format_id,
            keg_transactions.keg_owner_id,
            keg_transactions.from_state AS state,
            keg_transactions.from_location_id AS location_id,
            keg_transactions.batch_id,
            keg_transactions.finished_good_id,
            sum(keg_transactions.quantity) AS qty
           FROM keg_transactions
          WHERE keg_transactions.from_state IS NOT NULL
          GROUP BY keg_transactions.selling_format_id, keg_transactions.keg_owner_id, keg_transactions.from_state, keg_transactions.from_location_id, keg_transactions.batch_id, keg_transactions.finished_good_id
        ), combined AS (
         SELECT sub.selling_format_id,
            sub.keg_owner_id,
            sub.state,
            sub.location_id,
            sub.batch_id,
            sub.finished_good_id,
            COALESCE(sum(sub.qty), 0::numeric) AS quantity
           FROM ( SELECT inflows.selling_format_id,
                    inflows.keg_owner_id,
                    inflows.state,
                    inflows.location_id,
                    inflows.batch_id,
                    inflows.finished_good_id,
                    inflows.qty
                   FROM inflows
                UNION ALL
                 SELECT outflows.selling_format_id,
                    outflows.keg_owner_id,
                    outflows.state,
                    outflows.location_id,
                    outflows.batch_id,
                    outflows.finished_good_id,
                    - outflows.qty
                   FROM outflows) sub
          GROUP BY sub.selling_format_id, sub.keg_owner_id, sub.state, sub.location_id, sub.batch_id, sub.finished_good_id
         HAVING COALESCE(sum(sub.qty), 0::numeric) > 0::numeric
        )
 SELECT md5((((((((((COALESCE(selling_format_id::text, ''::text) || ':'::text) || COALESCE(keg_owner_id::text, ''::text)) || ':'::text) || COALESCE(state::text, ''::text)) || ':'::text) || COALESCE(location_id::text, ''::text)) || ':'::text) || COALESCE(batch_id::text, ''::text)) || ':'::text) || COALESCE(finished_good_id::text, ''::text))::uuid AS id,
    selling_format_id,
    keg_owner_id,
    state,
    location_id,
    quantity::integer AS quantity,
    batch_id,
    finished_good_id
   FROM combined;

CREATE OR REPLACE VIEW public.keg_inventory_summary
WITH (security_invoker = true) AS
 SELECT sf.id AS selling_format_id,
    c.name AS keg_type_name,
    c.volume_bbl,
    COALESCE(sum(ki.quantity) FILTER (WHERE ki.state = 'empty'::keg_state), 0::bigint) AS empty_count,
    COALESCE(sum(ki.quantity) FILTER (WHERE ki.state = 'filled'::keg_state), 0::bigint) AS filled_count,
    COALESCE(sum(ki.quantity) FILTER (WHERE ki.state = 'shipped'::keg_state), 0::bigint) AS shipped_count,
    COALESCE(sum(ki.quantity) FILTER (WHERE ki.state = 'returned_dirty'::keg_state), 0::bigint) AS dirty_count,
    COALESCE(sum(ki.quantity) FILTER (WHERE ki.state = 'cleaning'::keg_state), 0::bigint) AS cleaning_count,
    COALESCE(sum(ki.quantity) FILTER (WHERE ki.state = 'maintenance'::keg_state), 0::bigint) AS maintenance_count,
    COALESCE(sum(ki.quantity) FILTER (WHERE ki.state = 'retired'::keg_state), 0::bigint) AS retired_count,
    COALESCE(sum(ki.quantity), 0::bigint) AS total_count
   FROM selling_formats sf
     JOIN containers c ON c.id = sf.container_id AND c.type = 'keg'::text
     LEFT JOIN keg_inventory ki ON sf.id = ki.selling_format_id
  GROUP BY sf.id, c.name, c.volume_bbl
  ORDER BY c.volume_bbl DESC NULLS LAST;

CREATE OR REPLACE VIEW public.keg_turnover_metrics
WITH (security_invoker = true) AS
 WITH transaction_pairs AS (
         SELECT ship.selling_format_id,
            ship.keg_owner_id,
            ship.customer_id,
            ship.created_at AS shipped_at,
            ret.created_at AS returned_at,
            EXTRACT(day FROM ret.created_at - ship.created_at)::integer AS cycle_days
           FROM keg_transactions ship
             JOIN keg_transactions ret ON ret.customer_id = ship.customer_id AND ret.selling_format_id = ship.selling_format_id AND COALESCE(ret.keg_owner_id::text, ''::text) = COALESCE(ship.keg_owner_id::text, ''::text) AND ret.transaction_type = 'return'::keg_transaction_type AND ret.created_at > ship.created_at
          WHERE ship.transaction_type = 'ship'::keg_transaction_type AND ship.created_at > (now() - '365 days'::interval)
        )
 SELECT sf.id AS selling_format_id,
    c.name AS keg_type_name,
    c.volume_bbl,
    tp.keg_owner_id,
    ko.name AS keg_owner_name,
    count(tp.cycle_days) AS completed_cycles,
    COALESCE(avg(tp.cycle_days), 0::numeric)::numeric(10,1) AS avg_cycle_days,
    COALESCE(min(tp.cycle_days), 0) AS min_cycle_days,
    COALESCE(max(tp.cycle_days), 0) AS max_cycle_days,
        CASE
            WHEN COALESCE(avg(tp.cycle_days), 0::numeric) > 0::numeric THEN (365.0 / avg(tp.cycle_days))::numeric(10,2)
            ELSE 0::numeric
        END AS annual_turnover_rate
   FROM selling_formats sf
     JOIN containers c ON c.id = sf.container_id
     LEFT JOIN transaction_pairs tp ON sf.id = tp.selling_format_id
     LEFT JOIN keg_owners ko ON tp.keg_owner_id = ko.id
  WHERE c.type = 'keg'::text AND sf.is_active = true
  GROUP BY sf.id, c.name, c.volume_bbl, tp.keg_owner_id, ko.name
  ORDER BY c.name;

CREATE OR REPLACE VIEW public.bin_contents
WITH (security_invoker = true) AS
 SELECT bi.bin_id,
    'finished_good'::text AS item_type,
    fg.id AS item_id,
    b.name AS item_name,
    sf.name AS package_name,
    fg.lot_number,
    bi.quantity,
    fg.production_date AS item_date
   FROM bin_inventory bi
     JOIN finished_goods fg ON fg.id = bi.finished_good_id
     JOIN brands b ON b.id = fg.brand_id
     LEFT JOIN selling_formats sf ON sf.id = fg.selling_format_id
  WHERE bi.quantity > 0
UNION ALL
 SELECT bii.bin_id,
    'raw_material'::text AS item_type,
    il.id AS item_id,
    ii.name AS item_name,
    NULL::text AS package_name,
    il.lot_number,
    bii.quantity,
    il.received_date AS item_date
   FROM bin_inventory_items bii
     JOIN inventory_lots il ON il.id = bii.inventory_lot_id
     JOIN inventory_items ii ON ii.id = il.inventory_item_id
  WHERE bii.quantity > 0::numeric;

CREATE OR REPLACE VIEW public.customer_keg_balances
WITH (security_invoker = true) AS
 WITH balance_changes AS (
         SELECT keg_transactions.customer_id,
            keg_transactions.selling_format_id,
            keg_transactions.keg_owner_id,
            keg_transactions.quantity AS delta
           FROM keg_transactions
          WHERE keg_transactions.transaction_type = 'ship'::keg_transaction_type AND keg_transactions.customer_id IS NOT NULL
        UNION ALL
         SELECT keg_transactions.customer_id,
            keg_transactions.selling_format_id,
            keg_transactions.keg_owner_id,
            - keg_transactions.quantity AS delta
           FROM keg_transactions
          WHERE keg_transactions.transaction_type = 'return'::keg_transaction_type AND keg_transactions.customer_id IS NOT NULL
        )
 SELECT cust.id AS customer_id,
    cust.name AS customer_name,
    sf.id AS selling_format_id,
    c.name AS keg_type_name,
    c.volume_bbl,
    bc.keg_owner_id,
    ko.name AS keg_owner_name,
    COALESCE(kod.deposit_amount, c.deposit_amount) AS deposit_amount,
    sum(bc.delta) AS kegs_out,
    sum(bc.delta)::numeric * COALESCE(kod.deposit_amount, c.deposit_amount, 0::numeric) AS deposit_value
   FROM customers cust
     JOIN balance_changes bc ON cust.id = bc.customer_id
     JOIN selling_formats sf ON bc.selling_format_id = sf.id
     JOIN containers c ON c.id = sf.container_id
     LEFT JOIN keg_owners ko ON bc.keg_owner_id = ko.id
     LEFT JOIN keg_owner_deposits kod ON kod.keg_owner_id = bc.keg_owner_id AND kod.selling_format_id = bc.selling_format_id
  WHERE sf.is_active = true
  GROUP BY cust.id, cust.name, sf.id, c.name, c.volume_bbl, bc.keg_owner_id, ko.name, kod.deposit_amount, c.deposit_amount
 HAVING sum(bc.delta) <> 0
  ORDER BY cust.name, c.name;

CREATE OR REPLACE VIEW public.customer_keg_balance_summary
WITH (security_invoker = true) AS
 SELECT customer_id,
    customer_name,
    sum(kegs_out) AS total_kegs_out,
    sum(deposit_value) AS total_deposit_value,
    count(DISTINCT selling_format_id) AS keg_type_count
   FROM customer_keg_balances
  GROUP BY customer_id, customer_name
  ORDER BY customer_name;

CREATE OR REPLACE VIEW public.keg_aging_report
WITH (security_invoker = true) AS
 WITH shipped_kegs AS (
         SELECT kt.customer_id,
            kt.selling_format_id,
            kt.keg_owner_id,
            kt.created_at AS shipped_at,
            kt.quantity AS shipped_qty,
            kt.order_id
           FROM keg_transactions kt
          WHERE kt.transaction_type = 'ship'::keg_transaction_type AND kt.customer_id IS NOT NULL
        ), returned_kegs AS (
         SELECT keg_transactions.customer_id,
            keg_transactions.selling_format_id,
            keg_transactions.keg_owner_id,
            sum(keg_transactions.quantity) AS returned_qty
           FROM keg_transactions
          WHERE keg_transactions.transaction_type = 'return'::keg_transaction_type AND keg_transactions.customer_id IS NOT NULL
          GROUP BY keg_transactions.customer_id, keg_transactions.selling_format_id, keg_transactions.keg_owner_id
        ), keg_balances AS (
         SELECT s.customer_id,
            s.selling_format_id,
            s.keg_owner_id,
            s.shipped_at,
            s.order_id,
            s.shipped_qty,
            COALESCE(r.returned_qty, 0::bigint) AS total_returned,
            EXTRACT(day FROM now() - s.shipped_at)::integer AS days_out
           FROM shipped_kegs s
             LEFT JOIN returned_kegs r ON s.customer_id = r.customer_id AND s.selling_format_id = r.selling_format_id AND COALESCE(s.keg_owner_id::text, ''::text) = COALESCE(r.keg_owner_id::text, ''::text)
        )
 SELECT kb.customer_id,
    cust.name AS customer_name,
    kb.selling_format_id,
    c.name AS keg_type_name,
    kb.keg_owner_id,
    ko.name AS keg_owner_name,
    COALESCE(kod.deposit_amount, c.deposit_amount) AS deposit_amount,
    ckb.kegs_out,
    kb.days_out,
        CASE
            WHEN kb.days_out > 90 THEN 'critical'::text
            WHEN kb.days_out > 60 THEN 'warning'::text
            WHEN kb.days_out > 30 THEN 'attention'::text
            ELSE 'normal'::text
        END AS aging_status,
    ckb.kegs_out::numeric * COALESCE(kod.deposit_amount, c.deposit_amount, 0::numeric) AS deposit_at_risk
   FROM keg_balances kb
     JOIN customers cust ON kb.customer_id = cust.id
     JOIN selling_formats sf ON kb.selling_format_id = sf.id
     JOIN containers c ON c.id = sf.container_id
     LEFT JOIN keg_owners ko ON kb.keg_owner_id = ko.id
     LEFT JOIN keg_owner_deposits kod ON kod.keg_owner_id = kb.keg_owner_id AND kod.selling_format_id = kb.selling_format_id
     JOIN customer_keg_balances ckb ON kb.customer_id = ckb.customer_id AND kb.selling_format_id = ckb.selling_format_id AND COALESCE(kb.keg_owner_id::text, ''::text) = COALESCE(ckb.keg_owner_id::text, ''::text)
  WHERE ckb.kegs_out > 0
  ORDER BY kb.days_out DESC, cust.name;

CREATE OR REPLACE VIEW public.customer_keg_transaction_history
WITH (security_invoker = true) AS
 SELECT kt.id,
    kt.transaction_type,
    kt.selling_format_id,
    c.name AS keg_type_name,
    c.volume_bbl,
    kt.keg_owner_id,
    ko.name AS keg_owner_name,
    kt.quantity,
    kt.from_state,
    kt.to_state,
    kt.customer_id,
    cust.name AS customer_name,
    kt.order_id,
    o.order_number,
    kt.notes,
    kt.created_by_name,
    kt.created_at
   FROM keg_transactions kt
     JOIN selling_formats sf ON sf.id = kt.selling_format_id
     JOIN containers c ON c.id = sf.container_id
     LEFT JOIN keg_owners ko ON kt.keg_owner_id = ko.id
     LEFT JOIN customers cust ON kt.customer_id = cust.id
     LEFT JOIN orders o ON kt.order_id = o.id
  WHERE kt.customer_id IS NOT NULL AND (kt.transaction_type = ANY (ARRAY['ship'::keg_transaction_type, 'return'::keg_transaction_type]))
  ORDER BY kt.created_at DESC;

CREATE OR REPLACE VIEW public.finished_goods_with_availability
WITH (security_invoker = true) AS
 SELECT fg.id,
    fg.batch_id,
    fg.brand_id,
    fg.selling_format_id,
    fg.session_line_item_id,
    fg.quantity,
    fg.lot_number,
    fg.production_date,
    fg.best_by_date,
    fg.expiration_date,
    fg.notes,
    fg.version,
    fg.created_by,
    fg.created_at,
    fg.updated_at,
    b.name AS brand_name,
    sf.name AS selling_format_name,
    c.name AS container_name,
    c.type AS container_type,
    fg.quantity AS total_quantity,
    COALESCE(sum(
        CASE
            WHEN a.status = 'completed'::text THEN a.quantity
            ELSE 0::numeric
        END), 0::numeric) AS allocated_quantity,
    COALESCE(sum(
        CASE
            WHEN a.status = 'planned'::text THEN a.quantity
            ELSE 0::numeric
        END), 0::numeric) AS reserved_quantity,
    fg.quantity::numeric - COALESCE(sum(
        CASE
            WHEN a.status = ANY (ARRAY['planned'::text, 'completed'::text]) THEN a.quantity
            ELSE 0::numeric
        END), 0::numeric) AS available_quantity
   FROM finished_goods fg
     LEFT JOIN brands b ON b.id = fg.brand_id
     LEFT JOIN selling_formats sf ON sf.id = fg.selling_format_id
     LEFT JOIN containers c ON c.id = sf.container_id
     LEFT JOIN allocations a ON a.source_type = 'finished_good'::text AND a.source_id = fg.id
  GROUP BY fg.id, b.name, sf.name, c.name, c.type;

CREATE OR REPLACE VIEW public.finished_goods_supply_by_product
WITH (security_invoker = true) AS
 SELECT fg.brand_id,
    fg.selling_format_id,
    sum(fg.quantity)::integer AS total_quantity,
    sum(fga.available_quantity)::integer AS available_quantity,
    sum(fga.allocated_quantity)::integer AS allocated_quantity,
    sum(fga.reserved_quantity)::integer AS reserved_quantity
   FROM finished_goods fg
     JOIN finished_goods_with_availability fga ON fga.id = fg.id
  WHERE fg.brand_id IS NOT NULL AND fg.selling_format_id IS NOT NULL
  GROUP BY fg.brand_id, fg.selling_format_id;

CREATE OR REPLACE VIEW public.finished_goods_with_ttb_class
WITH (security_invoker = true) AS
 SELECT fg.id,
    fg.batch_id,
    fg.brand_id,
    fg.selling_format_id,
    fg.session_line_item_id,
    fg.quantity,
    fg.lot_number,
    fg.production_date,
    fg.best_by_date,
    fg.expiration_date,
    fg.notes,
    fg.version,
    fg.created_by,
    fg.created_at,
    fg.updated_at,
    sf.name AS selling_format_name,
    c.type AS container_type,
    COALESCE(c.volume_oz, (c.volume_bbl * 3968.0)::numeric(6,2)) AS volume_oz,
    sf.unit_count,
    get_ttb_tax_class(c.type) AS ttb_tax_class,
    (fg.quantity::numeric * COALESCE(c.volume_oz, (c.volume_bbl * 3968.0)::numeric(6,2)) / 3968.0)::numeric(10,4) AS volume_bbl,
    b.name AS brand_name
   FROM finished_goods fg
     LEFT JOIN selling_formats sf ON sf.id = fg.selling_format_id
     LEFT JOIN containers c ON c.id = sf.container_id
     JOIN brands b ON fg.brand_id = b.id;

CREATE OR REPLACE VIEW public.order_demand_by_product
WITH (security_invoker = true) AS
 SELECT oi.brand_id,
    oi.selling_format_id,
    date_trunc('week'::text, COALESCE(o.scheduled_date, o.requested_date)::timestamp with time zone)::date AS demand_week,
    sum(oi.quantity)::integer AS total_quantity,
    count(DISTINCT o.id)::integer AS order_count,
    min(COALESCE(o.scheduled_date, o.requested_date)) AS earliest_due_date,
    max(COALESCE(o.scheduled_date, o.requested_date)) AS latest_due_date,
    array_agg(DISTINCT o.id) AS order_ids,
    array_agg(DISTINCT o.status) AS order_statuses
   FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
  WHERE (o.status <> ALL (ARRAY['fulfilled'::text, 'cancelled'::text])) AND oi.brand_id IS NOT NULL AND oi.selling_format_id IS NOT NULL AND COALESCE(o.scheduled_date, o.requested_date) IS NOT NULL
  GROUP BY oi.brand_id, oi.selling_format_id, (date_trunc('week'::text, COALESCE(o.scheduled_date, o.requested_date)::timestamp with time zone));

CREATE OR REPLACE VIEW public.packaging_formats
WITH (security_invoker = true) AS
 SELECT sf.id,
    sf.name,
    c.name AS container_name,
    c.type AS container_type,
    c.volume_oz,
    c.volume_bbl,
    sf.unit_count,
    c.deposit_amount,
    sf.is_active,
    c.is_active AS container_active,
    sf.container_id,
    sf."position"
   FROM selling_formats sf
     JOIN containers c ON c.id = sf.container_id;

CREATE OR REPLACE VIEW public.recipe_ingredients_normalized
WITH (security_invoker = true) AS
 SELECT rm.recipe_id,
    'malt'::text AS catalog_type,
    rm.malt_id AS catalog_id,
    m.name AS catalog_name,
    rm.weight_lbs AS quantity,
    'lb'::text AS unit
   FROM recipe_malts rm
     JOIN malts m ON m.id = rm.malt_id
UNION ALL
 SELECT rh.recipe_id,
    'hop'::text AS catalog_type,
    rh.hop_id AS catalog_id,
    h.name AS catalog_name,
    rh.weight_oz / 16.0 AS quantity,
    'lb'::text AS unit
   FROM recipe_hops rh
     JOIN hops h ON h.id = rh.hop_id
UNION ALL
 SELECT ra.recipe_id,
    'adjunct'::text AS catalog_type,
    ra.adjunct_id AS catalog_id,
    a.name AS catalog_name,
    ra.weight_lbs AS quantity,
    'lb'::text AS unit
   FROM recipe_adjuncts ra
     JOIN adjuncts a ON a.id = ra.adjunct_id
UNION ALL
 SELECT rs.recipe_id,
    'sugar'::text AS catalog_type,
    rs.sugar_id AS catalog_id,
    s.name AS catalog_name,
    rs.weight_lbs AS quantity,
    'lb'::text AS unit
   FROM recipe_sugars rs
     JOIN sugars s ON s.id = rs.sugar_id
UNION ALL
 SELECT rsp.recipe_id,
    'spice'::text AS catalog_type,
    rsp.spice_id AS catalog_id,
    sp.name AS catalog_name,
        CASE rsp.unit
            WHEN 'oz'::text THEN rsp.amount
            WHEN 'g'::text THEN rsp.amount / 28.35
            WHEN 'tsp'::text THEN rsp.amount * 0.17
            WHEN 'tbsp'::text THEN rsp.amount * 0.5
            ELSE rsp.amount
        END AS quantity,
    'oz'::text AS unit
   FROM recipe_spices rsp
     JOIN spices sp ON sp.id = rsp.spice_id
UNION ALL
 SELECT rf.recipe_id,
    'fruit'::text AS catalog_type,
    rf.fruit_id AS catalog_id,
    f.name AS catalog_name,
        CASE rf.unit
            WHEN 'lb'::text THEN rf.amount
            WHEN 'oz'::text THEN rf.amount / 16.0
            WHEN 'kg'::text THEN rf.amount * 2.205
            ELSE rf.amount
        END AS quantity,
    'lb'::text AS unit
   FROM recipe_fruits rf
     JOIN fruits f ON f.id = rf.fruit_id;

CREATE OR REPLACE VIEW public.recipes_with_estimates
WITH (security_invoker = true) AS
 WITH grain_totals AS (
         SELECT rm.recipe_id,
            sum(rm.weight_lbs) AS total_grain_lbs,
            sum(rm.weight_lbs * COALESCE(rm.ppg::numeric, m.potential_ppg, 36::numeric)) AS total_points,
            sum(rm.weight_lbs * COALESCE(rm.color_lov, m.color_lovibond, 2::numeric)) AS mcu_sum
           FROM recipe_malts rm
             JOIN malts m ON m.id = rm.malt_id
          GROUP BY rm.recipe_id
        ), hop_ibu AS (
         SELECT rh.recipe_id,
            sum(rh.weight_oz * COALESCE(rh.alpha_acid, h.alpha_acid_typical, 10::numeric) *
                CASE rh.timing
                    WHEN 'boil'::text THEN
                    CASE
                        WHEN COALESCE(rh.boil_time_min, 60) >= 60 THEN 0.27
                        WHEN COALESCE(rh.boil_time_min, 60) >= 45 THEN 0.24
                        WHEN COALESCE(rh.boil_time_min, 60) >= 30 THEN 0.20
                        WHEN COALESCE(rh.boil_time_min, 60) >= 15 THEN 0.14
                        WHEN COALESCE(rh.boil_time_min, 60) >= 10 THEN 0.10
                        WHEN COALESCE(rh.boil_time_min, 60) >= 5 THEN 0.05
                        ELSE 0.02
                    END
                    WHEN 'first_wort'::text THEN 0.10
                    WHEN 'whirlpool'::text THEN 0.05
                    WHEN 'mash'::text THEN 0.08
                    ELSE 0::numeric
                END) AS weighted_ibu_factor
           FROM recipe_hops rh
             JOIN hops h ON h.id = rh.hop_id
          GROUP BY rh.recipe_id
        ), batch_counts AS (
         SELECT batches.recipe_id,
            count(*)::integer AS batch_count
           FROM batches
          WHERE batches.recipe_id IS NOT NULL
          GROUP BY batches.recipe_id
        )
 SELECT r.id,
    r.name,
    r.style,
    r.description,
    r.target_og,
    r.target_fg,
    r.target_abv,
    r.target_ibu,
    r.target_srm,
    r.batch_size_gallons,
    r.boil_time_min,
    r.mash_temp_f,
    r.ingredients,
    r.instructions,
    r.notes,
    r.is_active,
    r.created_at,
    r.updated_at,
    r.brand_id,
    r.style_id,
    r.yeast_id,
    r.water_profile_id,
    r.created_by,
    r.volume_bbl,
    r.batch_size_bbl,
    r.preboil_volume_bbl,
    r.target_ko_volume_bbl,
    r.mash_water_volume_gal,
    r.sparge_water_volume_gal,
    r.fermentation_days,
    r.conditioning_days,
    r.whirlpool_time_min,
    r.whirlpool_temp_f,
    r.whirlpool_rest_min,
    r.target_mash_ph,
    r.mash_efficiency,
    r.water_to_grain_ratio,
    r.target_ko_temp_f,
    r.target_attenuation,
    r.target_pitching_rate,
    r.yeast_nutrient_amount_g,
    r.mash_schedule,
    r.fermentation_schedule,
    r.brew_day_notes,
    r.tasting_notes,
    r.development_notes,
    r.target_water_profile_id,
    r.is_template,
    r.status,
    bs.name AS style_name,
        CASE
            WHEN gt.total_grain_lbs > 0::numeric AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1::numeric) > 0::numeric THEN round(1::numeric + gt.total_points * COALESCE(r.mash_efficiency, 75::numeric) / 100::numeric / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1::numeric) * 31::numeric) / 1000::numeric, 3)
            ELSE NULL::numeric
        END AS est_og,
        CASE
            WHEN gt.total_grain_lbs > 0::numeric AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1::numeric) > 0::numeric THEN round(1::numeric + gt.total_points * COALESCE(r.mash_efficiency, 75::numeric) / 100::numeric / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1::numeric) * 31::numeric) / 1000::numeric * (1::numeric - COALESCE(r.target_attenuation, y.attenuation_typical, 75::numeric) / 100::numeric), 3)
            ELSE NULL::numeric
        END AS est_fg,
        CASE
            WHEN gt.total_grain_lbs > 0::numeric AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1::numeric) > 0::numeric THEN round(gt.total_points * COALESCE(r.mash_efficiency, 75::numeric) / 100::numeric / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1::numeric) * 31::numeric) / 1000::numeric * COALESCE(r.target_attenuation, y.attenuation_typical, 75::numeric) / 100::numeric * 131.25, 1)
            ELSE NULL::numeric
        END AS est_abv,
        CASE
            WHEN hi.weighted_ibu_factor IS NOT NULL AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1::numeric) > 0::numeric THEN round(hi.weighted_ibu_factor * 74.89 / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1::numeric) * 31::numeric))
            ELSE NULL::numeric
        END AS est_ibu,
        CASE
            WHEN gt.mcu_sum IS NOT NULL AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1::numeric) > 0::numeric THEN round(1.4922 * power(gt.mcu_sum / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1::numeric) * 31::numeric), 0.6859), 1)
            ELSE NULL::numeric
        END AS est_srm,
    NULL::numeric AS est_cogs,
    COALESCE(bc.batch_count, 0) AS batch_count,
    r.pricing_tier_id
   FROM recipes r
     LEFT JOIN beer_styles bs ON bs.id = r.style_id
     LEFT JOIN grain_totals gt ON gt.recipe_id = r.id
     LEFT JOIN hop_ibu hi ON hi.recipe_id = r.id
     LEFT JOIN yeasts y ON y.id = r.yeast_id
     LEFT JOIN batch_counts bc ON bc.recipe_id = r.id;

CREATE OR REPLACE VIEW public.yeast_lineage_summary
WITH (security_invoker = true) AS
 WITH RECURSIVE lineage AS (
         SELECT yeast_pitches.id,
            yeast_pitches.id AS root_id,
            yeast_pitches.strain_id,
            yeast_pitches.parent_pitch_id,
            yeast_pitches.generation,
            yeast_pitches.source_type,
            yeast_pitches.cost,
            yeast_pitches.status
           FROM yeast_pitches
          WHERE yeast_pitches.source_type = 'purchase'::text
        UNION ALL
         SELECT yp.id,
            l_1.root_id,
            yp.strain_id,
            yp.parent_pitch_id,
            yp.generation,
            yp.source_type,
            yp.cost,
            yp.status
           FROM yeast_pitches yp
             JOIN lineage l_1 ON yp.parent_pitch_id = l_1.id
        )
 SELECT l.root_id,
    y.name AS strain_name,
    root.cost AS original_cost,
    count(l.id)::integer AS total_pitches_in_lineage,
    count(DISTINCT e.batch_id)::integer AS batches_used,
        CASE
            WHEN count(DISTINCT e.batch_id) > 0 THEN round(root.cost / count(DISTINCT e.batch_id)::numeric, 2)
            ELSE root.cost
        END AS cost_per_batch,
    max(l.generation) AS max_generations
   FROM lineage l
     JOIN yeasts y ON l.strain_id = y.id
     JOIN yeast_pitches root ON l.root_id = root.id
     LEFT JOIN yeast_pitch_events e ON e.pitch_id = l.id
  GROUP BY l.root_id, y.name, root.cost;

CREATE OR REPLACE VIEW public.yeast_pitches_with_remaining
WITH (security_invoker = true) AS
 SELECT yp.id,
    yp.strain_id,
    yp.source_type,
    yp.parent_pitch_id,
    yp.generation,
    yp.status,
    yp.volume_ml,
    yp.cell_count_thousand,
    yp.initial_viability,
    yp.current_viability,
    yp.cost,
    yp.cost_per_batch,
    yp.received_date,
    yp.harvest_date,
    yp.use_by_date,
    yp.location_id,
    yp.notes,
    yp.created_at,
    yp.updated_at,
    yp.created_by,
    yp.quantity_lbs,
    yp.cell_density_thousand,
    yp.vessel_id,
    y.name AS strain_name,
    y.manufacturer AS strain_manufacturer,
    y.product_code AS strain_code,
    y.type AS strain_type,
    y.form AS strain_form,
    y.attenuation_typical AS strain_attenuation,
    v.name AS vessel_name,
    v.vessel_type AS vessel_vessel_type,
    l.name AS location_name,
    yp.quantity_lbs - COALESCE(( SELECT sum(e.quantity_lbs) AS sum
           FROM yeast_pitch_events e
          WHERE e.pitch_id = yp.id), 0::numeric) AS quantity_remaining_lbs,
    COALESCE(( SELECT count(DISTINCT e.batch_id) AS count
           FROM yeast_pitch_events e
          WHERE e.pitch_id = yp.id), 0::bigint)::integer AS batches_pitched,
    EXTRACT(day FROM now() - COALESCE(yp.harvest_date::timestamp without time zone, yp.received_date::timestamp without time zone)::timestamp with time zone)::integer AS days_old,
    GREATEST(0::numeric, LEAST(100::numeric, yp.initial_viability - EXTRACT(day FROM now() - COALESCE(yp.harvest_date::timestamp without time zone, yp.received_date::timestamp without time zone)::timestamp with time zone) *
        CASE
            WHEN y.form = 'dry'::text THEN 0.5
            ELSE 2.0
        END))::numeric(5,2) AS estimated_viability,
        CASE
            WHEN GREATEST(0::numeric, yp.initial_viability - EXTRACT(day FROM now() - COALESCE(yp.harvest_date::timestamp without time zone, yp.received_date::timestamp without time zone)::timestamp with time zone) *
            CASE
                WHEN y.form = 'dry'::text THEN 0.5
                ELSE 2.0
            END) >= 90::numeric THEN 'excellent'::text
            WHEN GREATEST(0::numeric, yp.initial_viability - EXTRACT(day FROM now() - COALESCE(yp.harvest_date::timestamp without time zone, yp.received_date::timestamp without time zone)::timestamp with time zone) *
            CASE
                WHEN y.form = 'dry'::text THEN 0.5
                ELSE 2.0
            END) >= 75::numeric THEN 'good'::text
            WHEN GREATEST(0::numeric, yp.initial_viability - EXTRACT(day FROM now() - COALESCE(yp.harvest_date::timestamp without time zone, yp.received_date::timestamp without time zone)::timestamp with time zone) *
            CASE
                WHEN y.form = 'dry'::text THEN 0.5
                ELSE 2.0
            END) >= 50::numeric THEN 'marginal'::text
            WHEN GREATEST(0::numeric, yp.initial_viability - EXTRACT(day FROM now() - COALESCE(yp.harvest_date::timestamp without time zone, yp.received_date::timestamp without time zone)::timestamp with time zone) *
            CASE
                WHEN y.form = 'dry'::text THEN 0.5
                ELSE 2.0
            END) >= 25::numeric THEN 'low'::text
            ELSE 'inactive'::text
        END AS viability_status
   FROM yeast_pitches yp
     JOIN yeasts y ON yp.strain_id = y.id
     LEFT JOIN vessels v ON yp.vessel_id = v.id
     LEFT JOIN locations l ON yp.location_id = l.id;

CREATE OR REPLACE VIEW public.customers_with_order_summary
WITH (security_invoker = true) AS
 WITH ot AS (
         SELECT order_items.order_id,
            sum(order_items.quantity::numeric * order_items.unit_price) AS total_value
           FROM order_items
          GROUP BY order_items.order_id
        ), order_stats AS (
         SELECT o.customer_id,
            count(*)::integer AS total_orders,
            sum(
                CASE
                    WHEN o.status = 'fulfilled'::text THEN COALESCE(ot.total_value, 0::numeric)
                    ELSE 0::numeric
                END) AS total_revenue,
            max(o.order_date) AS last_order_date,
            count(*) FILTER (WHERE o.status <> ALL (ARRAY['fulfilled'::text, 'cancelled'::text]))::integer AS pending_orders,
            sum(
                CASE
                    WHEN o.status <> ALL (ARRAY['fulfilled'::text, 'cancelled'::text]) THEN COALESCE(ot.total_value, 0::numeric)
                    ELSE 0::numeric
                END) AS pending_revenue
           FROM orders o
             LEFT JOIN ot ON ot.order_id = o.id
          GROUP BY o.customer_id
        )
 SELECT c.id,
    c.name,
    c.customer_type,
    c.contact_name,
    c.email,
    c.phone,
    c.address,
    c.notes,
    c.is_active,
    c.created_at,
    c.updated_at,
    c.sales_channel_id,
    c.price_tier_id,
    c.is_tax_exempt,
    c.payment_terms_days,
    sc.name AS sales_channel_name,
    pt.name AS price_tier_name,
    COALESCE(os.total_orders, 0) AS total_orders,
    COALESCE(os.total_revenue, 0::numeric) AS total_revenue,
    os.last_order_date,
    COALESCE(os.pending_orders, 0) AS pending_orders,
    COALESCE(os.pending_revenue, 0::numeric) AS pending_revenue,
    COALESCE(kb.total_kegs_out, 0::numeric)::integer AS total_kegs_out,
    COALESCE(kb.total_deposit_value, 0::numeric)::numeric(10,2) AS total_deposit_value
   FROM customers c
     LEFT JOIN sales_channels sc ON c.sales_channel_id = sc.id
     LEFT JOIN pricing_tiers pt ON c.price_tier_id = pt.id
     LEFT JOIN order_stats os ON os.customer_id = c.id
     LEFT JOIN customer_keg_balance_summary kb ON c.id = kb.customer_id;

CREATE OR REPLACE FUNCTION public.calculate_production_shortfalls(p_include_drafts boolean DEFAULT true, p_horizon_weeks integer DEFAULT 8)
 RETURNS TABLE(brand_id uuid, brand_name text, selling_format_id uuid, selling_format_name text, demand_week date, demand_quantity integer, available_quantity integer, in_production_bbl numeric, in_production_units integer, shortfall_quantity integer, recommended_brew_start date, lead_time_days integer, recipe_id uuid, recipe_name text, is_urgent boolean)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_packaging_buffer INTEGER := 2;
BEGIN
  RETURN QUERY
  WITH demand AS (
    SELECT oi.brand_id, oi.selling_format_id, DATE_TRUNC('week', COALESCE(o.scheduled_date, o.requested_date))::date AS demand_week, SUM(oi.quantity)::integer AS quantity
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE (CASE WHEN p_include_drafts THEN o.status NOT IN ('fulfilled','cancelled') ELSE o.status IN ('confirmed','scheduled','picking','packed') END)
      AND oi.brand_id IS NOT NULL AND oi.selling_format_id IS NOT NULL AND COALESCE(o.scheduled_date, o.requested_date) IS NOT NULL
      AND COALESCE(o.scheduled_date, o.requested_date) <= CURRENT_DATE + (p_horizon_weeks * 7)
    GROUP BY oi.brand_id, oi.selling_format_id, DATE_TRUNC('week', COALESCE(o.scheduled_date, o.requested_date))
  ),
  supply AS (
    SELECT fgsp.brand_id, fgsp.selling_format_id, COALESCE(fgsp.available_quantity, 0)::integer AS available_qty FROM finished_goods_supply_by_product fgsp
  ),
  in_production AS (
    SELECT bip.brand_id, d_inner.selling_format_id, SUM(bip.volume_bbl) AS volume_bbl,
      SUM(bip.volume_bbl * COALESCE(calculate_units_per_bbl(cont.volume_oz, sf.unit_count), 10.0))::integer AS estimated_units
    FROM batches_in_production_by_brand bip
    CROSS JOIN LATERAL (SELECT DISTINCT d.selling_format_id FROM demand d WHERE d.brand_id = bip.brand_id) d_inner
    JOIN selling_formats sf ON sf.id = d_inner.selling_format_id JOIN containers cont ON cont.id = sf.container_id
    GROUP BY bip.brand_id, d_inner.selling_format_id
  ),
  preferred_recipe AS (
    SELECT DISTINCT ON (r.brand_id) r.brand_id, r.id AS recipe_id, r.name AS recipe_name,
      COALESCE(r.fermentation_days, 14) AS fermentation_days, COALESCE(r.conditioning_days, 7) AS conditioning_days
    FROM recipes r WHERE r.is_active = true AND r.brand_id IS NOT NULL ORDER BY r.brand_id, r.updated_at DESC
  )
  SELECT d.brand_id, b.name, d.selling_format_id, sf.name, d.demand_week, d.quantity, COALESCE(s.available_qty, 0),
    COALESCE(ip.volume_bbl, 0), COALESCE(ip.estimated_units, 0),
    GREATEST(d.quantity - COALESCE(s.available_qty, 0) - COALESCE(ip.estimated_units, 0), 0)::integer,
    (d.demand_week - (COALESCE(pr.fermentation_days, 14) + COALESCE(pr.conditioning_days, 7) + v_packaging_buffer))::date,
    (COALESCE(pr.fermentation_days, 14) + COALESCE(pr.conditioning_days, 7) + v_packaging_buffer),
    pr.recipe_id, pr.recipe_name,
    (d.demand_week - (COALESCE(pr.fermentation_days, 14) + COALESCE(pr.conditioning_days, 7) + v_packaging_buffer))::date <= CURRENT_DATE + 7
  FROM demand d JOIN brands b ON b.id = d.brand_id JOIN selling_formats sf ON sf.id = d.selling_format_id
  LEFT JOIN supply s ON s.brand_id = d.brand_id AND s.selling_format_id = d.selling_format_id
  LEFT JOIN in_production ip ON ip.brand_id = d.brand_id AND ip.selling_format_id = d.selling_format_id
  LEFT JOIN preferred_recipe pr ON pr.brand_id = d.brand_id
  WHERE d.quantity > COALESCE(s.available_qty, 0) + COALESCE(ip.estimated_units, 0)
  ORDER BY (d.demand_week - (COALESCE(pr.fermentation_days, 14) + COALESCE(pr.conditioning_days, 7) + v_packaging_buffer))::date <= CURRENT_DATE + 7 DESC, d.demand_week, d.brand_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.get_ttb_inventory_summary(p_year integer, p_month integer)
 RETURNS TABLE(ttb_tax_class text, beginning_inventory_bbl numeric, ending_inventory_bbl numeric, in_process_beginning_bbl numeric, in_process_ending_bbl numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH period_dates AS (
    SELECT
      make_date(p_year, p_month, 1) AS period_start,
      (make_date(p_year, p_month, 1) + INTERVAL '1 month')::TIMESTAMPTZ AS period_end_ts
  ),
  fg_produced_before AS (
    SELECT
      fg.id,
      get_ttb_tax_class(c.type) AS tax_class,
      (fg.quantity * c.volume_oz / 3968.0)::DECIMAL(10,4) AS produced_bbl
    FROM finished_goods fg
    JOIN selling_formats sf ON sf.id = fg.selling_format_id
    JOIN containers c ON c.id = sf.container_id
    CROSS JOIN period_dates pd
    WHERE fg.production_date < pd.period_start
  ),
  alloc_before AS (
    SELECT
      a.source_id AS fg_id,
      get_ttb_tax_class(c.type) AS tax_class,
      COALESCE(a.volume_bbl, 0) AS removed_bbl
    FROM allocations a
    JOIN finished_goods fg ON a.source_type = 'finished_good' AND a.source_id = fg.id
    JOIN selling_formats sf ON sf.id = fg.selling_format_id
    JOIN containers c ON c.id = sf.container_id
    CROSS JOIN period_dates pd
    WHERE a.status = 'completed'
      AND a.created_at < pd.period_start
  ),
  fg_beginning AS (
    SELECT
      tax_class,
      GREATEST(0, SUM(produced_bbl) - COALESCE(
        (SELECT SUM(removed_bbl) FROM alloc_before ab WHERE ab.tax_class = fpb.tax_class),
        0
      )) AS volume_bbl
    FROM fg_produced_before fpb
    GROUP BY tax_class
  ),
  fg_produced_end AS (
    SELECT
      fg.id,
      get_ttb_tax_class(c.type) AS tax_class,
      (fg.quantity * c.volume_oz / 3968.0)::DECIMAL(10,4) AS produced_bbl
    FROM finished_goods fg
    JOIN selling_formats sf ON sf.id = fg.selling_format_id
    JOIN containers c ON c.id = sf.container_id
    CROSS JOIN period_dates pd
    WHERE fg.production_date < pd.period_end_ts::DATE
  ),
  alloc_end AS (
    SELECT
      a.source_id AS fg_id,
      get_ttb_tax_class(c.type) AS tax_class,
      COALESCE(a.volume_bbl, 0) AS removed_bbl
    FROM allocations a
    JOIN finished_goods fg ON a.source_type = 'finished_good' AND a.source_id = fg.id
    JOIN selling_formats sf ON sf.id = fg.selling_format_id
    JOIN containers c ON c.id = sf.container_id
    CROSS JOIN period_dates pd
    WHERE a.status = 'completed'
      AND a.created_at < pd.period_end_ts
  ),
  fg_ending AS (
    SELECT
      tax_class,
      GREATEST(0, SUM(produced_bbl) - COALESCE(
        (SELECT SUM(removed_bbl) FROM alloc_end ae WHERE ae.tax_class = fpe.tax_class),
        0
      )) AS volume_bbl
    FROM fg_produced_end fpe
    GROUP BY tax_class
  ),
  ip_beginning AS (
    SELECT
      'cellar' AS tax_class,
      SUM(b.volume_bbl) AS volume_bbl
    FROM batches b
    CROSS JOIN period_dates pd
    WHERE b.status IN ('fermenting', 'conditioning', 'packaging')
      AND b.created_at < pd.period_start
    GROUP BY 1
  ),
  ip_ending AS (
    SELECT
      'cellar' AS tax_class,
      SUM(b.volume_bbl) AS volume_bbl
    FROM batches b
    WHERE b.status IN ('fermenting', 'conditioning', 'packaging')
    GROUP BY 1
  )
  SELECT
    tc.tax_class AS ttb_tax_class,
    COALESCE(fgb.volume_bbl, 0) AS beginning_inventory_bbl,
    COALESCE(fge.volume_bbl, 0) AS ending_inventory_bbl,
    COALESCE(ipb.volume_bbl, 0) AS in_process_beginning_bbl,
    COALESCE(ipe.volume_bbl, 0) AS in_process_ending_bbl
  FROM (VALUES ('cellar'), ('keg'), ('bottled')) AS tc(tax_class)
  LEFT JOIN fg_beginning fgb ON fgb.tax_class = tc.tax_class
  LEFT JOIN fg_ending fge ON fge.tax_class = tc.tax_class
  LEFT JOIN ip_beginning ipb ON ipb.tax_class = tc.tax_class
  LEFT JOIN ip_ending ipe ON ipe.tax_class = tc.tax_class;
$function$;

CREATE OR REPLACE FUNCTION public.get_ttb_production_summary(p_year integer, p_month integer)
 RETURNS TABLE(ttb_tax_class text, beer_produced_bbl numeric, beer_packaged_bbl numeric, finished_goods_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH period_dates AS (
    SELECT
      make_date(p_year, p_month, 1) AS period_start,
      (make_date(p_year, p_month, 1) + INTERVAL '1 month' - INTERVAL '1 day')::DATE AS period_end
  ),
  fg_summary AS (
    SELECT
      get_ttb_tax_class(c.type) AS tax_class,
      SUM((fg.quantity * c.volume_oz / 3968.0)::DECIMAL(10,4)) AS packaged_bbl,
      COUNT(*) AS fg_count
    FROM finished_goods fg
    JOIN selling_formats sf ON sf.id = fg.selling_format_id
    JOIN containers c ON c.id = sf.container_id
    CROSS JOIN period_dates pd
    WHERE fg.production_date >= pd.period_start
      AND fg.production_date <= pd.period_end
    GROUP BY get_ttb_tax_class(c.type)
  ),
  batch_summary AS (
    SELECT
      'cellar' AS tax_class,
      SUM(b.volume_bbl) AS produced_bbl
    FROM batches b
    CROSS JOIN period_dates pd
    WHERE b.status = 'completed'
      AND DATE(b.updated_at) >= pd.period_start
      AND DATE(b.updated_at) <= pd.period_end
    GROUP BY 1
  ),
  all_classes AS (
    SELECT tax_class FROM fg_summary
    UNION
    SELECT tax_class FROM batch_summary
  )
  SELECT
    ac.tax_class AS ttb_tax_class,
    COALESCE(bs.produced_bbl, 0) AS beer_produced_bbl,
    COALESCE(fs.packaged_bbl, 0) AS beer_packaged_bbl,
    COALESCE(fs.fg_count, 0) AS finished_goods_count
  FROM all_classes ac
  LEFT JOIN batch_summary bs ON bs.tax_class = ac.tax_class
  LEFT JOIN fg_summary fs ON fs.tax_class = ac.tax_class;
$function$;

CREATE OR REPLACE FUNCTION public.get_ttb_removals_summary(p_year integer, p_month integer)
 RETURNS TABLE(ttb_tax_class text, taxpaid_domestic_bbl numeric, taxpaid_export_bbl numeric, tax_free_samples_bbl numeric, losses_bbl numeric, destroyed_bbl numeric, adjustments_bbl numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH period_dates AS (
    SELECT
      make_date(p_year, p_month, 1) AS period_start,
      (make_date(p_year, p_month, 1) + INTERVAL '1 month')::DATE AS period_end
  ),
  fg_allocations AS (
    SELECT
      a.id,
      a.destination_type,
      a.reason_code,
      a.volume_bbl,
      a.quantity,
      a.created_at,
      COALESCE(
        get_ttb_tax_class(c.type),
        'bottled'
      ) AS tax_class,
      CASE
        WHEN a.destination_type = 'order' THEN
          (SELECT o.is_export FROM orders o WHERE o.id = a.destination_id)
        ELSE FALSE
      END AS is_export
    FROM allocations a
    LEFT JOIN finished_goods fg ON a.source_type = 'finished_good' AND a.source_id = fg.id
    LEFT JOIN selling_formats sf ON sf.id = fg.selling_format_id
    LEFT JOIN containers c ON c.id = sf.container_id
    CROSS JOIN period_dates pd
    WHERE a.status = 'completed'
      AND a.created_at >= pd.period_start
      AND a.created_at < pd.period_end
      AND a.source_type = 'finished_good'
  )
  SELECT
    tc.tax_class AS ttb_tax_class,
    COALESCE(SUM(CASE
      WHEN a.destination_type = 'order' AND NOT COALESCE(a.is_export, FALSE)
      THEN a.volume_bbl ELSE 0
    END), 0) AS taxpaid_domestic_bbl,
    COALESCE(SUM(CASE
      WHEN a.destination_type = 'order' AND COALESCE(a.is_export, FALSE)
      THEN a.volume_bbl ELSE 0
    END), 0) AS taxpaid_export_bbl,
    COALESCE(SUM(CASE
      WHEN a.destination_type = 'sample'
      THEN a.volume_bbl ELSE 0
    END), 0) AS tax_free_samples_bbl,
    COALESCE(SUM(CASE
      WHEN a.destination_type = 'loss'
      THEN a.volume_bbl ELSE 0
    END), 0) AS losses_bbl,
    COALESCE(SUM(CASE
      WHEN a.destination_type = 'destruction'
      THEN a.volume_bbl ELSE 0
    END), 0) AS destroyed_bbl,
    COALESCE(SUM(CASE
      WHEN a.destination_type = 'adjustment'
      THEN a.volume_bbl ELSE 0
    END), 0) AS adjustments_bbl
  FROM (VALUES ('cellar'), ('keg'), ('bottled')) AS tc(tax_class)
  LEFT JOIN fg_allocations a ON a.tax_class = tc.tax_class
  GROUP BY tc.tax_class;
$function$;

CREATE OR REPLACE FUNCTION public.notify_all_users(p_type text, p_title text, p_message text DEFAULT NULL::text, p_entity_type text DEFAULT NULL::text, p_entity_id uuid DEFAULT NULL::uuid, p_priority text DEFAULT 'normal'::text, p_action_url text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user RECORD;
  v_count INTEGER := 0;
  v_slack RECORD;
  v_log_id UUID;
BEGIN
  FOR v_user IN
    SELECT DISTINCT id FROM auth.users
  LOOP
    PERFORM create_notification(
      v_user.id,
      p_type,
      p_title,
      p_message,
      p_entity_type,
      p_entity_id,
      p_priority,
      p_action_url,
      p_metadata
    );

    BEGIN
      PERFORM dispatch_email_notification(
        v_user.id,
        p_type,
        p_title,
        p_message,
        p_priority,
        p_action_url,
        p_metadata
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Email dispatch failed for user %: %', v_user.id, SQLERRM;
    END;

    v_count := v_count + 1;
  END LOOP;

  SELECT is_enabled, internal_secret, app_url
    INTO v_slack
    FROM slack_settings
    LIMIT 1;

  IF v_slack.is_enabled THEN
    INSERT INTO slack_notification_log (notification_type, title, message, priority, action_url, metadata, status)
    VALUES (p_type, p_title, p_message, p_priority, p_action_url, p_metadata, 'pending')
    RETURNING id INTO v_log_id;

    IF v_slack.app_url IS NOT NULL AND v_slack.app_url != '' THEN
      PERFORM net.http_post(
        url := v_slack.app_url || '/api/slack/send',
        body := jsonb_build_object(
          'log_id', v_log_id,
          'type', p_type,
          'title', p_title,
          'message', p_message,
          'priority', p_priority,
          'action_url', p_action_url,
          'metadata', p_metadata
        ),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'X-Slack-Secret', v_slack.internal_secret
        )
      );
    ELSE
      UPDATE slack_notification_log
        SET status = 'skipped', error_message = 'app_url not configured in slack_settings'
        WHERE id = v_log_id;
    END IF;
  END IF;

  RETURN v_count;
END;
$function$;
-- Reload PostgREST schema cache so the API picks up the refreshed definitions.
NOTIFY pgrst, 'reload schema';
