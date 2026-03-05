-- Migrate brew event phases and metrics from hardcoded configs to enum_values
-- Enables brewery-specific customization via Settings > Status & Options

-- =============================================================================
-- Brew Phases (brew_phase)
-- =============================================================================

-- group_name maps to the grouped phase selector in the brew event form

INSERT INTO enum_values (enum_type, value, label, icon, sort_order, group_name, is_active, is_default, metadata) VALUES
  -- Mash group
  ('brew_phase', 'strike_water',      'Strike Water',      'droplet',         10, 'mash',      true, false, '{}'),
  ('brew_phase', 'mash_in',           'Mash In',           'grain',           20, 'mash',      true, true,  '{}'),
  ('brew_phase', 'mash_rest',         'Mash Rest',         'clock',           30, 'mash',      true, false, '{}'),
  ('brew_phase', 'mash_step',         'Mash Step',         'thermometer',     40, 'mash',      true, false, '{}'),
  -- Lauter group
  ('brew_phase', 'vorlauf',           'Vorlauf',           'refresh',         50, 'lauter',    true, false, '{}'),
  ('brew_phase', 'runoff_start',      'Runoff Start',      'arrow-down',      60, 'lauter',    true, false, '{}'),
  ('brew_phase', 'runoff_end',        'Runoff End',        'check',           70, 'lauter',    true, false, '{}'),
  ('brew_phase', 'sparge_start',      'Sparge Start',      'droplet',         80, 'lauter',    true, false, '{}'),
  ('brew_phase', 'sparge_end',        'Sparge End',        'check',           90, 'lauter',    true, false, '{}'),
  -- Boil group
  ('brew_phase', 'kettle_full',       'Kettle Full',       'container',      100, 'boil',      true, false, '{}'),
  ('brew_phase', 'boil_start',        'Boil Start',        'flame',          110, 'boil',      true, false, '{}'),
  ('brew_phase', 'hop_addition',      'Hop Addition',      'leaf',           120, 'boil',      true, false, '{}'),
  ('brew_phase', 'adjunct_addition',  'Adjunct Addition',  'plus',           130, 'boil',      true, false, '{}'),
  ('brew_phase', 'boil_end',          'Boil End',          'check',          140, 'boil',      true, false, '{}'),
  -- Whirlpool group
  ('brew_phase', 'whirlpool_start',   'Whirlpool Start',   'refresh',        150, 'whirlpool', true, false, '{}'),
  ('brew_phase', 'whirlpool_rest',    'Whirlpool Rest',    'clock',          160, 'whirlpool', true, false, '{}'),
  ('brew_phase', 'whirlpool_end',     'Whirlpool End',     'check',          170, 'whirlpool', true, false, '{}'),
  -- Knockout group
  ('brew_phase', 'ko_start',          'Knock Out Start',   'arrow-right',    180, 'knockout',  true, false, '{}'),
  ('brew_phase', 'ko_end',            'Knock Out End',     'check',          190, 'knockout',  true, false, '{}'),
  ('brew_phase', 'yeast_pitch',       'Yeast Pitch',       'flask',          200, 'knockout',  true, false, '{}'),
  -- Other group
  ('brew_phase', 'hourly_check',      'Hourly Check',      'clock',          210, 'other',     true, false, '{}'),
  ('brew_phase', 'flow_rate_change',  'Flow Rate Change',  'sliders',        220, 'other',     true, false, '{}'),
  ('brew_phase', 'other',             'Other',             'more-horizontal', 230, 'other',     true, false, '{}');

-- =============================================================================
-- Brew Metrics (brew_metric)
-- =============================================================================

-- metadata stores unitType and decimals for UnitInput rendering
-- unit is stored in description for display when no unitType is specified

INSERT INTO enum_values (enum_type, value, label, description, sort_order, is_active, is_default, metadata) VALUES
  ('brew_metric', 'temp_f',         'Temperature',     '°F',      10, true, false, '{"unitType": "temperature", "decimals": 1}'),
  ('brew_metric', 'ph',             'pH',              '',         20, true, false, '{}'),
  ('brew_metric', 'volume_bbl',     'Volume (BBL)',    'BBL',      30, true, false, '{"unitType": "volume", "decimals": 2}'),
  ('brew_metric', 'volume_l',       'Volume (L)',      'L',        40, true, false, '{"unitType": "volume", "decimals": 2}'),
  ('brew_metric', 'gravity_plato',  'Gravity',         '°P',       50, true, false, '{"unitType": "gravity", "decimals": 1}'),
  ('brew_metric', 'flow_rate',      'Flow Rate',       '',         60, true, false, '{}'),
  ('brew_metric', 'pump_speed',     'Pump Speed',      '',         70, true, false, '{}'),
  ('brew_metric', 'amount_lbs',     'Amount (lbs)',    'lbs',      80, true, false, '{"unitType": "weight", "decimals": 2}'),
  ('brew_metric', 'amount_oz',      'Amount (oz)',     'oz',       90, true, false, '{}'),
  ('brew_metric', 'amount_g',       'Amount (g)',      'g',       100, true, false, '{}'),
  ('brew_metric', 'viability',      'Viability',       '%',       110, true, false, '{}'),
  ('brew_metric', 'pitch_rate',     'Pitching Rate',   'M/mL/°P', 120, true, false, '{}'),
  ('brew_metric', 'other',          'Other',           '',        130, true, false, '{}');

-- =============================================================================
-- Update schema registry
-- =============================================================================

UPDATE _schema_registry
SET ai_context = jsonb_set(
  COALESCE(ai_context, '{}'::jsonb),
  '{brew_enums}',
  '"brew_phase and brew_metric enum types in enum_values table — configurable brew day phases and measurement metrics"'
)
WHERE table_name = 'enum_values';
