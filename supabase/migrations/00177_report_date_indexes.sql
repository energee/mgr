-- Indexes for report date-range filters (audit fix plan, deferred item).
-- The COGS report range-filters batches.created_at (shared query) and
-- finished_goods.created_at (by-SKU tab); neither column was indexed.
CREATE INDEX IF NOT EXISTS idx_batches_created_at ON public.batches (created_at);
CREATE INDEX IF NOT EXISTS idx_finished_goods_created_at ON public.finished_goods (created_at);
