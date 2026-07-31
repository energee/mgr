-- Migration: 00285_capture_channel_formats
--
-- Captures the last two live-only TABLES into the migration chain (#724,
-- found during the #696 feature-tracker audit). Same shape of problem, and
-- same remedy, as 00199 (containers/selling_formats) and 00214
-- (get_price_for_customer): live has objects no migration creates, so a
-- from-scratch replay produces a database the shipped app cannot run against.
--
-- History of the two tables — they are one lineage, not two features:
--
--   * 00117_pricing_channel_formats created `pricing_channel_formats`
--     (sales_channel_id x format_id -> packaging_formats) and 00125 tightened
--     its RLS. BOTH files were deleted by the #217 renumbering reconciliation,
--     so the chain lost the table entirely.
--   * The container/selling-format redesign then superseded it out-of-band
--     with `channel_formats` (id PK, selling_format_id -> selling_formats),
--     because `packaging_formats` became a view over
--     `selling_formats JOIN containers`. No migration was ever written for
--     the successor either.
--
-- Result: `channel_formats` is live-only but LOAD-BEARING — format-management.tsx
-- and pricing-matrix-view.tsx read and write it, and it gates which formats
-- reach the Square catalog push. `pricing_channel_formats` is live-only and
-- DEAD — nothing but generated types (src/types/supabase.ts) references it.
--
-- Shapes below are not guesswork. They are cross-checked against three
-- independent sources that agree column-for-column:
--   1. src/types/supabase.ts, generated from live (`bun run db:generate`)
--   2. docs/data-model/packaging.md ("channel_formats")
--   3. docs/plans/2026-03-01-container-selling-format-redesign-design.md
--      and, for the legacy table, the recovered 00117 body
--      (`git show 2909140d^:supabase/migrations/00117_pricing_channel_formats.sql`)
--
-- Policy bodies are verified byte-exact against live, not merely plausible:
-- supabase/live-catalog.snapshot.txt stores md5(qual || '~' || with_check) per
-- policy, and each hash written here already appears in that snapshot on
-- sibling tables whose SQL IS in the chain (channel_formats' pair matches
-- containers/selling_formats from 00199 -- 5671938a.../3b67933a...; the
-- restrictive gate matches 00255's loop form on 106 tables -- ee25f986...).
--
-- On live, everything here is a no-op EXCEPT the deliberate fix in section 4.

-- ---------------------------------------------------------------------------
-- 1. channel_formats -- the live, load-bearing junction table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS channel_formats (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  selling_format_id UUID NOT NULL REFERENCES selling_formats(id) ON DELETE CASCADE,
  sales_channel_id  UUID NOT NULL REFERENCES sales_channels(id) ON DELETE CASCADE,
  UNIQUE (selling_format_id, sales_channel_id)
);

COMMENT ON TABLE channel_formats IS
  'Junction table: presence of a row means the selling format is visible in that sales channel''s pricing matrix.';

-- The UNIQUE pair is the app's actual invariant, not decoration:
-- format-management.tsx keys a Map on `${selling_format_id}:${sales_channel_id}`
-- and toggles OFF by deleting on that pair, so a duplicate row would strand a
-- toggle in the ON position. Constraints are NOT recorded in
-- live-catalog.snapshot.txt (it captures tables, policies, RLS, functions and
-- triggers only), so this constraint is asserted from the data-model doc and
-- app semantics rather than verified against live.

-- ---------------------------------------------------------------------------
-- 2. RLS -- catalog pattern (any-auth read, settings:manage write), identical
--    to containers/selling_formats in 00199 and hash-matched to live.
-- ---------------------------------------------------------------------------
ALTER TABLE channel_formats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS channel_formats_select ON channel_formats;
CREATE POLICY channel_formats_select ON channel_formats
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS channel_formats_write ON channel_formats;
CREATE POLICY channel_formats_write ON channel_formats
  FOR ALL
  USING (user_has_permission('settings:manage'))
  WITH CHECK (user_has_permission('settings:manage'));

-- Permissive-SELECT marker for the 00198 guardrail
-- (src/__tests__/integration/rls-coverage.test.ts).
COMMENT ON POLICY channel_formats_select ON channel_formats IS
  'RLS-EXCEPTION: catalog/reference table; write is gated by settings:manage on the companion _write policy.';

-- ---------------------------------------------------------------------------
-- 3. pricing_channel_formats -- the superseded predecessor (00117 shape)
--
-- Captured rather than dropped: dropping a live table with rows is not
-- reversible from a migration, needs live credentials this chain does not
-- have, and buys nothing while it is inert. Retiring it is a separate,
-- deliberate decision (see #724); this migration only makes replay match live.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pricing_channel_formats (
  sales_channel_id UUID NOT NULL REFERENCES sales_channels(id) ON DELETE CASCADE,
  format_id        UUID NOT NULL,
  PRIMARY KEY (sales_channel_id, format_id)
);

COMMENT ON TABLE pricing_channel_formats IS
  'SUPERSEDED by channel_formats (container/selling-format redesign). Retained because it still holds rows on live; no application code reads it.';

-- ---------------------------------------------------------------------------
-- 4. pricing_channel_formats RLS -- capture AND close a live gap
--
-- This is the one section that changes live. 00125 replaced 00117's three
-- permissive `USING (true)` policies with the settings:manage pattern, but
-- 00125 was deleted in the #217 reconciliation before it ever reached live:
-- the snapshot still shows all three original policies (hashes ec053f58... =
-- `true~` for SELECT/DELETE and a452132919... = `~true` for INSERT -- both
-- confirmed by computing the md5 directly). So on live today ANY authenticated
-- user can read, insert and delete rows here regardless of role.
--
-- Impact is contained (no app code touches the table) but the gap is real, and
-- the loose policies would fail the 00198 permissive-policy guardrail on sight.
-- Applying 00125's intent, exactly as 00199 section 3a did for email_settings.
-- ---------------------------------------------------------------------------
ALTER TABLE pricing_channel_formats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view pricing channel formats" ON pricing_channel_formats;
DROP POLICY IF EXISTS "Authenticated users can insert pricing channel formats" ON pricing_channel_formats;
DROP POLICY IF EXISTS "Authenticated users can delete pricing channel formats" ON pricing_channel_formats;

DROP POLICY IF EXISTS pricing_channel_formats_select ON pricing_channel_formats;
CREATE POLICY pricing_channel_formats_select ON pricing_channel_formats
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS pricing_channel_formats_write ON pricing_channel_formats;
CREATE POLICY pricing_channel_formats_write ON pricing_channel_formats
  FOR ALL
  USING (user_has_permission('settings:manage'))
  WITH CHECK (user_has_permission('settings:manage'));

COMMENT ON POLICY pricing_channel_formats_select ON pricing_channel_formats IS
  'RLS-EXCEPTION: superseded catalog/reference table retained for its live rows; write is gated by settings:manage on the companion _write policy.';

-- ---------------------------------------------------------------------------
-- 5. Disabled-account gate (00255)
--
-- 00255 installs `current_user_enabled` on every RLS-enabled public table via
-- a DO-loop that ran at 00255. Tables created after it must state the policy
-- themselves or the account-status-rls inventory guard fails the chain
-- (src/__tests__/integration/account-status-rls.test.ts). Same reason 00266
-- and 00272 restate it. The `(SELECT ...)` init-plan form is what 00255's loop
-- emits, and is what live already carries on both tables (ee25f986...).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS current_user_enabled ON channel_formats;
CREATE POLICY current_user_enabled
  ON public.channel_formats
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING ((SELECT current_user_is_enabled()))
  WITH CHECK ((SELECT current_user_is_enabled()));

DROP POLICY IF EXISTS current_user_enabled ON pricing_channel_formats;
CREATE POLICY current_user_enabled
  ON public.pricing_channel_formats
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING ((SELECT current_user_is_enabled()))
  WITH CHECK ((SELECT current_user_is_enabled()));

-- ---------------------------------------------------------------------------
-- 6. Schema registry (AGENTS.md: every new table gets an entry)
-- ---------------------------------------------------------------------------
INSERT INTO _schema_registry (table_name, description, domain, relationships)
VALUES
  (
    'channel_formats',
    'Junction table: which selling formats appear in the pricing matrix for each sales channel',
    'sales',
    '[{"type":"belongsTo","target":"selling_formats","fk":"selling_format_id"},{"type":"belongsTo","target":"sales_channels","fk":"sales_channel_id"}]'
  ),
  (
    'pricing_channel_formats',
    'Superseded by channel_formats; retained for existing live rows and referenced by no application code',
    'sales',
    '[{"type":"belongsTo","target":"sales_channels","fk":"sales_channel_id"},{"type":"referencesFormat","target":"packaging_formats","fk":"format_id"}]'
  )
ON CONFLICT (table_name) DO UPDATE SET
  description   = EXCLUDED.description,
  domain        = EXCLUDED.domain,
  relationships = EXCLUDED.relationships;

NOTIFY pgrst, 'reload schema';
