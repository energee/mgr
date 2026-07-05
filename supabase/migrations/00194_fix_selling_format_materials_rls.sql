-- Task 3 (RLS coverage-gap plan): tighten selling_format_materials policy.
--
-- Migration 00160 created selling_format_materials with a single
-- FOR ALL policy of USING (true) WITH CHECK (true) restricted only to the
-- `authenticated` role — any logged-in user could read or modify the BOM.
--
-- Domain analysis: selling_format_materials is a BOM (bill-of-materials)
-- junction table that defines what packaging materials each selling format
-- consumes. It is admin-configured (via src/components/domain/packaging/
-- selling-format-bom-editor.tsx) and read by material-planning queries
-- (src/hooks/use-material-planning.ts plus the calculate_material_shortfalls
-- RPC from 00163). That is structurally a catalog: anyone can read, only
-- admins can write.
--
-- Applies the catalog pattern: SELECT for any authenticated user,
-- INSERT/UPDATE/DELETE gated by settings:manage.

DROP POLICY IF EXISTS selling_format_materials_authenticated ON selling_format_materials;

CREATE POLICY selling_format_materials_select ON selling_format_materials
  FOR SELECT
  USING ((SELECT auth.uid()) IS NOT NULL);

CREATE POLICY selling_format_materials_write ON selling_format_materials
  FOR ALL
  USING (user_has_permission('settings:manage'))
  WITH CHECK (user_has_permission('settings:manage'));
