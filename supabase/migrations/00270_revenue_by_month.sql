-- 00270_revenue_by_month.sql
-- Adds get_revenue_by_month(): revenue and order count per calendar month per
-- year, powering the "Monthly Revenue" year-over-year chart on the sales
-- dashboard. Same revenue basis as get_sales_trends / get_revenue_by_year:
-- SUM(quantity * unit_price) from order_items, excluding cancelled orders.

CREATE OR REPLACE FUNCTION public.get_revenue_by_month()
 RETURNS TABLE(year integer, month integer, order_count integer, revenue numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    EXTRACT(YEAR FROM o.order_date)::integer AS year,
    EXTRACT(MONTH FROM o.order_date)::integer AS month,
    COUNT(*)::integer AS order_count,
    COALESCE(SUM(oi_totals.total), 0)::numeric AS revenue
  FROM orders o
  LEFT JOIN (
    SELECT order_id, SUM(quantity * unit_price) AS total
    FROM order_items
    GROUP BY order_id
  ) oi_totals ON oi_totals.order_id = o.id
  WHERE o.status != 'cancelled'
    AND o.order_date IS NOT NULL
  GROUP BY 1, 2
  ORDER BY year, month;
$function$
;
