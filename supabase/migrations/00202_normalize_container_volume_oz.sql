-- =============================================================================
-- Normalize containers.volume_oz to per-unit semantics
-- =============================================================================
-- Audit 2026-07-06 finding H6: live `containers.volume_oz` carried MIXED
-- semantics — most rows stored the volume of ONE container (per-unit, e.g.
-- "11.25oz Glass"), but three rows stored the rolled-up total of a whole
-- case/pack. Display code papered over the mix with a MIN_PER_UNIT_OZ
-- heuristic (src/hooks/use-catalog.ts, removed alongside this migration),
-- while volume math assumed per-unit unconditionally:
--   - computeUnitFillVolumeBbl (src/domain/consumption-planning.ts) computes
--     volume_oz / 3968 x unit_count -> up to 24x packaged-volume overstatement
--     for rolled-up rows (flowing into planned-qty suggestions, suggested
--     losses, and the TTB loss ledger).
--
-- DECIDED: per-unit is the canonical semantic. The three rolled-up rows below
-- were identified by direct live inspection (containers joined to
-- selling_formats.unit_count) on 2026-07-06. Each UPDATE targets an explicit
-- row id and is guarded on the current rolled-up value, so the migration is
-- idempotent: already-normalized databases (and from-scratch replays, which
-- have no container rows — 00199 creates the table but seeds no data) are
-- unaffected. Deliberately NOT a blind divide-by-unit_count heuristic: most
-- rows with unit_count > 1 ("11.25oz Glass" x12, "16oz Glass" x12,
-- "16oz Can" x24 Case) are already per-unit and must not be touched.

-- "202.88oz Can": both selling formats are "Case of 12 ... 500ml"
-- (unit_count = 12); 202.88 oz is the case total. Per-unit = 202.88 / 12
-- = 16.9067 -> 16.91 at the column's NUMERIC(6,2) scale (a 500 ml bottle
-- is 16.91 US fl oz).
UPDATE containers
SET volume_oz = 16.91
WHERE id = 'a54496a6-59d1-42df-908d-301278a5ba22'
  AND volume_oz = 202.88;

-- "384oz Can": historical selling format was a case of 24 x 16 oz cans
-- (unit_count = 24; the row currently has no selling_format pointing at it,
-- but 384 = 24 x 16 and no 384 oz can exists). Per-unit = 384 / 24 = 16.00.
UPDATE containers
SET volume_oz = 16.00
WHERE id = '84d1442a-495c-43a6-869f-13bda47443fb'
  AND volume_oz = 384.00;

-- "64oz Can": its selling format is "Four Pack" (unit_count = 4); 64 oz is
-- the pack total for 4 x 16 oz cans. Per-unit = 64 / 4 = 16.00. (The display
-- heuristic already rendered this row as "16oz x 4", so normalizing preserves
-- what users saw; a genuine 64 oz crowler would carry a single-unit format.)
UPDATE containers
SET volume_oz = 16.00
WHERE id = '70bac947-9b29-4579-b1ab-e1993fa1de74'
  AND volume_oz = 64.00;

-- Pin the canonical semantic at the schema level.
COMMENT ON COLUMN containers.volume_oz IS
  'Volume of ONE container unit in US fluid ounces (per-unit — NEVER a case/pack total; normalized in 00202). A selling format''s total volume is volume_oz x selling_formats.unit_count. Required for package-type containers (00199 CHECK); keg containers carry volume_bbl instead and leave this NULL.';
