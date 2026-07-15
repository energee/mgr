-- Restore application tables that were created out-of-band during the
-- containers/selling-formats refactor. This reserved migration slot is before
-- the first selling_formats reference in 00159 and before email_settings is
-- referenced by 00190. It is safe on the hosted database, where the tables
-- already exist and the legacy package_types/keg_types tables are gone.

CREATE TABLE IF NOT EXISTS public.containers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL UNIQUE,
  type           TEXT NOT NULL CHECK (type IN ('package', 'keg')),
  volume_oz      NUMERIC(6,2),
  volume_bbl     NUMERIC(10,4),
  deposit_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  position       INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT containers_deposit_keg_only CHECK (type = 'keg' OR deposit_amount = 0),
  CONSTRAINT containers_keg_needs_bbl CHECK (type <> 'keg' OR volume_bbl IS NOT NULL),
  CONSTRAINT containers_package_needs_oz CHECK (type <> 'package' OR volume_oz IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.selling_formats (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  container_id UUID NOT NULL REFERENCES public.containers(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  unit_count   INTEGER NOT NULL DEFAULT 1 CHECK (unit_count > 0),
  is_active    BOOLEAN NOT NULL DEFAULT true,
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (container_id, name)
);

CREATE INDEX IF NOT EXISTS idx_selling_formats_container
  ON public.selling_formats(container_id);

CREATE TABLE IF NOT EXISTS public.email_settings (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  is_enabled           BOOLEAN NOT NULL DEFAULT false,
  supabase_project_url TEXT,
  app_url              TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.containers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.selling_formats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_settings ENABLE ROW LEVEL SECURITY;

-- The lost refactor deliberately reused legacy package/keg UUIDs for the new
-- selling formats. Preserve that mapping on a fresh replay so later legacy-FK
-- backfills (including square_draft_sales) are lossless. Hosted databases skip
-- these blocks because the legacy tables no longer exist there.
DO $$
BEGIN
  IF to_regclass('public.package_types') IS NOT NULL THEN
    INSERT INTO public.containers (
      name,
      type,
      volume_oz,
      is_active,
      position,
      created_at,
      updated_at
    )
    SELECT
      CASE
        WHEN legacy.volume_oz = floor(legacy.volume_oz)
          THEN floor(legacy.volume_oz)::text
        ELSE legacy.volume_oz::text
      END || 'oz ' || initcap(legacy.container_type),
      'package',
      legacy.volume_oz,
      legacy.is_active,
      legacy.position,
      legacy.created_at,
      legacy.updated_at
    FROM (
      SELECT
        container_type,
        volume_oz,
        bool_or(COALESCE(is_active, true)) AS is_active,
        row_number() OVER (ORDER BY container_type, volume_oz) * 10 AS position,
        COALESCE(min(created_at), now()) AS created_at,
        COALESCE(max(updated_at), now()) AS updated_at
      FROM public.package_types
      WHERE container_type <> 'keg'
      GROUP BY container_type, volume_oz
    ) AS legacy
    ON CONFLICT (name) DO NOTHING;

    INSERT INTO public.selling_formats (
      id,
      container_id,
      name,
      unit_count,
      is_active,
      position,
      created_at,
      updated_at
    )
    SELECT
      pt.id,
      c.id,
      pt.name,
      COALESCE(pt.units_per_case, 1),
      COALESCE(pt.is_active, true),
      row_number() OVER (
        PARTITION BY c.id
        ORDER BY COALESCE(pt.units_per_case, 1), pt.id
      ) * 10,
      COALESCE(pt.created_at, now()),
      COALESCE(pt.updated_at, now())
    FROM public.package_types AS pt
    JOIN public.containers AS c
      ON c.type = 'package'
     AND c.volume_oz = pt.volume_oz
     AND lower(c.name) LIKE '%' || lower(pt.container_type) || '%'
    WHERE pt.container_type <> 'keg'
    ON CONFLICT DO NOTHING;
  END IF;

  IF to_regclass('public.keg_types') IS NOT NULL THEN
    INSERT INTO public.containers (
      name,
      type,
      volume_bbl,
      deposit_amount,
      is_active,
      position,
      created_at,
      updated_at
    )
    SELECT
      kt.name,
      'keg',
      kt.volume_bbl,
      COALESCE(kt.deposit_amount, 0),
      COALESCE(kt.is_active, true),
      COALESCE(kt.position, 0) + 1000,
      COALESCE(kt.created_at, now()),
      COALESCE(kt.updated_at, now())
    FROM public.keg_types AS kt
    ON CONFLICT (name) DO NOTHING;

    INSERT INTO public.selling_formats (
      id,
      container_id,
      name,
      unit_count,
      is_active,
      position,
      created_at,
      updated_at
    )
    SELECT
      kt.id,
      c.id,
      'Per Keg',
      1,
      COALESCE(kt.is_active, true),
      0,
      COALESCE(kt.created_at, now()),
      COALESCE(kt.updated_at, now())
    FROM public.keg_types AS kt
    JOIN public.containers AS c
      ON c.type = 'keg'
     AND c.name = kt.name
    ON CONFLICT DO NOTHING;
  END IF;
END
$$;

INSERT INTO public._schema_registry (
  table_name,
  description,
  domain,
  relationships,
  key_fields
)
VALUES
  (
    'containers',
    'Physical packaging containers: cans, bottles, and kegs. Parent of selling_formats.',
    'inventory',
    '["has_many: selling_formats"]'::jsonb,
    '["name", "type", "volume_oz", "volume_bbl", "deposit_amount", "is_active"]'::jsonb
  ),
  (
    'selling_formats',
    'Sellable groupings of a container, such as a 4-pack, case, or keg.',
    'inventory',
    '["belongs_to: containers"]'::jsonb,
    '["name", "container_id", "unit_count", "is_active"]'::jsonb
  ),
  (
    'email_settings',
    'Single-row outbound notification email configuration.',
    'auth',
    '[]'::jsonb,
    '["is_enabled", "supabase_project_url", "app_url"]'::jsonb
  )
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships,
  key_fields = EXCLUDED.key_fields;
