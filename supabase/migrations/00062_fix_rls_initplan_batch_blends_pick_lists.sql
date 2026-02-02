-- Fix RLS initplan warnings: wrap auth.uid() in (select ...) to avoid
-- per-row re-evaluation.

-- ============================================================
-- batch_blends
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can view batch blends" ON public.batch_blends;
CREATE POLICY "Authenticated users can view batch blends" ON public.batch_blends
  FOR SELECT USING ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can insert batch blends" ON public.batch_blends;
CREATE POLICY "Authenticated users can insert batch blends" ON public.batch_blends
  FOR INSERT WITH CHECK ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can update batch blends" ON public.batch_blends;
CREATE POLICY "Authenticated users can update batch blends" ON public.batch_blends
  FOR UPDATE USING ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can delete batch blends" ON public.batch_blends;
CREATE POLICY "Authenticated users can delete batch blends" ON public.batch_blends
  FOR DELETE USING ((select auth.uid()) IS NOT NULL);

-- ============================================================
-- pick_lists
-- ============================================================
DROP POLICY IF EXISTS "Users can view pick lists" ON public.pick_lists;
CREATE POLICY "Users can view pick lists" ON public.pick_lists
  FOR SELECT USING ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "Users can insert pick lists" ON public.pick_lists;
CREATE POLICY "Users can insert pick lists" ON public.pick_lists
  FOR INSERT WITH CHECK ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "Users can update pick lists" ON public.pick_lists;
CREATE POLICY "Users can update pick lists" ON public.pick_lists
  FOR UPDATE USING ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "Users can delete pick lists" ON public.pick_lists;
CREATE POLICY "Users can delete pick lists" ON public.pick_lists
  FOR DELETE USING ((select auth.uid()) IS NOT NULL);

-- ============================================================
-- pick_list_items
-- ============================================================
DROP POLICY IF EXISTS "Users can view pick list items" ON public.pick_list_items;
CREATE POLICY "Users can view pick list items" ON public.pick_list_items
  FOR SELECT USING ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "Users can insert pick list items" ON public.pick_list_items;
CREATE POLICY "Users can insert pick list items" ON public.pick_list_items
  FOR INSERT WITH CHECK ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "Users can update pick list items" ON public.pick_list_items;
CREATE POLICY "Users can update pick list items" ON public.pick_list_items
  FOR UPDATE USING ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "Users can delete pick list items" ON public.pick_list_items;
CREATE POLICY "Users can delete pick list items" ON public.pick_list_items
  FOR DELETE USING ((select auth.uid()) IS NOT NULL);
