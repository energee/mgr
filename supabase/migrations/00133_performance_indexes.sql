-- Performance indexes for common query patterns
--
-- This migration adds indexes that were identified as missing for
-- frequently-used query patterns. Many of the originally-planned
-- indexes already exist from earlier migrations:
--
--   idx_allocations_source       -> covered by 00010 (source_type, source_id, status)
--   idx_allocations_destination  -> covered by 00010 (destination_type, destination_id, status)
--   idx_allocations_status       -> covered by 00010 (status, created_at DESC)
--   idx_finished_goods_brand     -> covered by 00010 + 00061 (brand_id)
--   idx_order_items_order        -> covered by 00001 + 00061 (order_id)
--   idx_batches_status           -> covered by 00002 + 00012 (status)
--   idx_batches_recipe           -> covered by 00012 + 00061 (recipe_id)
--
-- The only missing index is on finished_goods.production_date, which is
-- used for FIFO pick-list allocation and TTB reporting date ranges.

CREATE INDEX IF NOT EXISTS idx_finished_goods_production_date
  ON finished_goods(production_date);
