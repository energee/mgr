-- AI Integration Migration
-- Adds database functions and views for AI agent interaction

-- ============================================================================
-- SCHEMA REGISTRY ENHANCEMENTS
-- ============================================================================

-- Add AI-specific columns to schema registry if not present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = '_schema_registry' AND column_name = 'ai_context'
  ) THEN
    ALTER TABLE _schema_registry ADD COLUMN ai_context JSONB DEFAULT '{}';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = '_schema_registry' AND column_name = 'calculated_fields'
  ) THEN
    ALTER TABLE _schema_registry ADD COLUMN calculated_fields JSONB DEFAULT '[]';
  END IF;
END $$;

-- ============================================================================
-- RECIPE ANALYSIS FUNCTIONS
-- ============================================================================

-- Function to analyze a recipe against its style guidelines
CREATE OR REPLACE FUNCTION analyze_recipe_style_compliance(p_recipe_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_result JSONB;
  v_recipe RECORD;
  v_style RECORD;
BEGIN
  -- Get recipe with estimates
  SELECT r.*, re.est_og, re.est_fg, re.est_abv, re.est_ibu, re.est_srm
  INTO v_recipe
  FROM recipes r
  LEFT JOIN recipes_with_estimates re ON re.id = r.id
  WHERE r.id = p_recipe_id;

  IF v_recipe IS NULL THEN
    RETURN jsonb_build_object('error', 'Recipe not found');
  END IF;

  -- Get style guidelines
  SELECT * INTO v_style
  FROM beer_styles
  WHERE id = v_recipe.style_id;

  IF v_style IS NULL THEN
    RETURN jsonb_build_object('error', 'Style not found', 'recipe_id', p_recipe_id);
  END IF;

  -- Build analysis result
  v_result := jsonb_build_object(
    'recipe_id', p_recipe_id,
    'recipe_name', v_recipe.name,
    'style_name', v_style.name,
    'style_category', v_style.category,
    'analysis', jsonb_build_object(
      'og', jsonb_build_object(
        'value', v_recipe.est_og,
        'min', v_style.og_min,
        'max', v_style.og_max,
        'status', CASE
          WHEN v_recipe.est_og IS NULL THEN 'unknown'
          WHEN v_recipe.est_og < v_style.og_min THEN 'below_range'
          WHEN v_recipe.est_og > v_style.og_max THEN 'above_range'
          ELSE 'in_range'
        END
      ),
      'fg', jsonb_build_object(
        'value', v_recipe.est_fg,
        'min', v_style.fg_min,
        'max', v_style.fg_max,
        'status', CASE
          WHEN v_recipe.est_fg IS NULL THEN 'unknown'
          WHEN v_recipe.est_fg < v_style.fg_min THEN 'below_range'
          WHEN v_recipe.est_fg > v_style.fg_max THEN 'above_range'
          ELSE 'in_range'
        END
      ),
      'abv', jsonb_build_object(
        'value', v_recipe.est_abv,
        'min', v_style.abv_min,
        'max', v_style.abv_max,
        'status', CASE
          WHEN v_recipe.est_abv IS NULL THEN 'unknown'
          WHEN v_recipe.est_abv < v_style.abv_min THEN 'below_range'
          WHEN v_recipe.est_abv > v_style.abv_max THEN 'above_range'
          ELSE 'in_range'
        END
      ),
      'ibu', jsonb_build_object(
        'value', v_recipe.est_ibu,
        'min', v_style.ibu_min,
        'max', v_style.ibu_max,
        'status', CASE
          WHEN v_recipe.est_ibu IS NULL THEN 'unknown'
          WHEN v_recipe.est_ibu < v_style.ibu_min THEN 'below_range'
          WHEN v_recipe.est_ibu > v_style.ibu_max THEN 'above_range'
          ELSE 'in_range'
        END
      ),
      'srm', jsonb_build_object(
        'value', v_recipe.est_srm,
        'min', v_style.srm_min,
        'max', v_style.srm_max,
        'status', CASE
          WHEN v_recipe.est_srm IS NULL THEN 'unknown'
          WHEN v_recipe.est_srm < v_style.srm_min THEN 'below_range'
          WHEN v_recipe.est_srm > v_style.srm_max THEN 'above_range'
          ELSE 'in_range'
        END
      )
    ),
    'overall_compliance', (
      SELECT COUNT(*) = 5 FROM (
        SELECT 1 WHERE v_recipe.est_og BETWEEN v_style.og_min AND v_style.og_max
        UNION ALL
        SELECT 1 WHERE v_recipe.est_fg BETWEEN v_style.fg_min AND v_style.fg_max
        UNION ALL
        SELECT 1 WHERE v_recipe.est_abv BETWEEN v_style.abv_min AND v_style.abv_max
        UNION ALL
        SELECT 1 WHERE v_recipe.est_ibu BETWEEN v_style.ibu_min AND v_style.ibu_max
        UNION ALL
        SELECT 1 WHERE v_recipe.est_srm BETWEEN v_style.srm_min AND v_style.srm_max
      ) counts
    )
  );

  RETURN v_result;
END;
$$;

-- Function to get recipe summary for AI
CREATE OR REPLACE FUNCTION get_recipe_summary(p_recipe_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'recipe', jsonb_build_object(
      'id', r.id,
      'name', r.name,
      'volume_bbl', r.volume_bbl,
      'batch_size_bbl', r.batch_size_bbl,
      'boil_time_min', r.boil_time_min,
      'mash_temp_f', r.mash_temp_f,
      'mash_efficiency', r.mash_efficiency,
      'target_attenuation', r.target_attenuation,
      'fermentation_days', r.fermentation_days,
      'conditioning_days', r.conditioning_days
    ),
    'estimates', jsonb_build_object(
      'og', re.est_og,
      'fg', re.est_fg,
      'abv', re.est_abv,
      'ibu', re.est_ibu,
      'srm', re.est_srm,
      'cogs', re.est_cogs
    ),
    'style', jsonb_build_object(
      'id', bs.id,
      'name', bs.name,
      'category', bs.category,
      'og_range', jsonb_build_array(bs.og_min, bs.og_max),
      'fg_range', jsonb_build_array(bs.fg_min, bs.fg_max),
      'abv_range', jsonb_build_array(bs.abv_min, bs.abv_max),
      'ibu_range', jsonb_build_array(bs.ibu_min, bs.ibu_max),
      'srm_range', jsonb_build_array(bs.srm_min, bs.srm_max)
    ),
    'yeast', jsonb_build_object(
      'id', y.id,
      'name', y.name,
      'type', y.type,
      'attenuation_min', y.attenuation_min,
      'attenuation_max', y.attenuation_max,
      'temp_min_f', y.temp_min_f,
      'temp_max_f', y.temp_max_f,
      'flocculation', y.flocculation
    ),
    'water_profile', CASE WHEN wp.id IS NOT NULL THEN jsonb_build_object(
      'id', wp.id,
      'name', wp.name,
      'calcium_ppm', wp.calcium_ppm,
      'magnesium_ppm', wp.magnesium_ppm,
      'sodium_ppm', wp.sodium_ppm,
      'sulfate_ppm', wp.sulfate_ppm,
      'chloride_ppm', wp.chloride_ppm,
      'bicarbonate_ppm', wp.bicarbonate_ppm,
      'sulfate_chloride_ratio', ROUND(wp.sulfate_ppm / NULLIF(wp.chloride_ppm, 0), 2)
    ) ELSE NULL END,
    'grain_bill', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'malt_name', m.name,
        'malt_type', m.type,
        'weight_lbs', rm.weight_lbs,
        'color_lov', rm.color_lov,
        'ppg', rm.ppg,
        'percentage', ROUND(rm.weight_lbs * 100.0 / NULLIF(total.total_weight, 0), 1)
      ) ORDER BY rm.position), '[]'::jsonb)
      FROM recipe_malts rm
      JOIN malts m ON m.id = rm.malt_id
      CROSS JOIN (
        SELECT SUM(weight_lbs) as total_weight
        FROM recipe_malts
        WHERE recipe_id = p_recipe_id
      ) total
      WHERE rm.recipe_id = p_recipe_id
    ),
    'hop_schedule', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'hop_name', h.name,
        'hop_type', h.type,
        'weight_oz', rh.weight_oz,
        'alpha_acid', rh.alpha_acid,
        'timing', rh.timing,
        'boil_time_min', rh.boil_time_min
      ) ORDER BY rh.position), '[]'::jsonb)
      FROM recipe_hops rh
      JOIN hops h ON h.id = rh.hop_id
      WHERE rh.recipe_id = p_recipe_id
    ),
    'mash_schedule', r.mash_schedule,
    'fermentation_schedule', r.fermentation_schedule,
    'notes', jsonb_build_object(
      'brew_day', r.brew_day_notes,
      'tasting', r.tasting_notes,
      'development', r.development_notes
    )
  ) INTO v_result
  FROM recipes r
  LEFT JOIN recipes_with_estimates re ON re.id = r.id
  LEFT JOIN beer_styles bs ON bs.id = r.style_id
  LEFT JOIN yeasts y ON y.id = r.yeast_id
  LEFT JOIN water_profiles wp ON wp.id = r.water_profile_id
  WHERE r.id = p_recipe_id;

  RETURN COALESCE(v_result, jsonb_build_object('error', 'Recipe not found'));
END;
$$;

-- Function to suggest recipe improvements
CREATE OR REPLACE FUNCTION suggest_recipe_improvements(p_recipe_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_suggestions JSONB := '[]'::jsonb;
  v_recipe RECORD;
  v_style RECORD;
  v_water RECORD;
  v_yeast RECORD;
  v_grain_bill RECORD;
  v_hop_schedule RECORD;
BEGIN
  -- Get recipe with all related data
  SELECT r.*, re.est_og, re.est_fg, re.est_abv, re.est_ibu, re.est_srm
  INTO v_recipe
  FROM recipes r
  LEFT JOIN recipes_with_estimates re ON re.id = r.id
  WHERE r.id = p_recipe_id;

  IF v_recipe IS NULL THEN
    RETURN jsonb_build_object('error', 'Recipe not found');
  END IF;

  -- Get style
  SELECT * INTO v_style FROM beer_styles WHERE id = v_recipe.style_id;

  -- Get yeast
  SELECT * INTO v_yeast FROM yeasts WHERE id = v_recipe.yeast_id;

  -- Get water profile
  SELECT * INTO v_water FROM water_profiles WHERE id = v_recipe.water_profile_id;

  -- Get grain bill summary
  SELECT
    SUM(rm.weight_lbs) as total_weight,
    SUM(CASE WHEN m.type = 'base' THEN rm.weight_lbs ELSE 0 END) as base_weight,
    COUNT(*) as malt_count
  INTO v_grain_bill
  FROM recipe_malts rm
  JOIN malts m ON m.id = rm.malt_id
  WHERE rm.recipe_id = p_recipe_id;

  -- Get hop schedule summary
  SELECT
    COUNT(*) as hop_count,
    SUM(CASE WHEN rh.timing = 'dry_hop' THEN rh.weight_oz ELSE 0 END) as dry_hop_oz,
    SUM(CASE WHEN rh.timing = 'boil' AND rh.boil_time_min >= 45 THEN rh.weight_oz ELSE 0 END) as bittering_oz
  INTO v_hop_schedule
  FROM recipe_hops rh
  WHERE rh.recipe_id = p_recipe_id;

  -- Check style compliance
  IF v_style IS NOT NULL THEN
    IF v_recipe.est_og < v_style.og_min THEN
      v_suggestions := v_suggestions || jsonb_build_object(
        'category', 'style_compliance',
        'severity', 'warning',
        'message', format('OG (%.3f) is below style minimum (%.3f). Consider increasing base malt or reducing volume.', v_recipe.est_og, v_style.og_min),
        'parameter', 'og'
      );
    ELSIF v_recipe.est_og > v_style.og_max THEN
      v_suggestions := v_suggestions || jsonb_build_object(
        'category', 'style_compliance',
        'severity', 'warning',
        'message', format('OG (%.3f) is above style maximum (%.3f). Consider reducing base malt or increasing volume.', v_recipe.est_og, v_style.og_max),
        'parameter', 'og'
      );
    END IF;

    IF v_recipe.est_ibu < v_style.ibu_min THEN
      v_suggestions := v_suggestions || jsonb_build_object(
        'category', 'style_compliance',
        'severity', 'warning',
        'message', format('IBU (%s) is below style minimum (%s). Consider adding more bittering hops.', v_recipe.est_ibu, v_style.ibu_min),
        'parameter', 'ibu'
      );
    ELSIF v_recipe.est_ibu > v_style.ibu_max THEN
      v_suggestions := v_suggestions || jsonb_build_object(
        'category', 'style_compliance',
        'severity', 'warning',
        'message', format('IBU (%s) is above style maximum (%s). Consider reducing bittering hops.', v_recipe.est_ibu, v_style.ibu_max),
        'parameter', 'ibu'
      );
    END IF;

    IF v_recipe.est_srm < v_style.srm_min THEN
      v_suggestions := v_suggestions || jsonb_build_object(
        'category', 'style_compliance',
        'severity', 'info',
        'message', format('Color (%s SRM) is lighter than style minimum (%s). Consider adding specialty malts.', v_recipe.est_srm, v_style.srm_min),
        'parameter', 'srm'
      );
    ELSIF v_recipe.est_srm > v_style.srm_max THEN
      v_suggestions := v_suggestions || jsonb_build_object(
        'category', 'style_compliance',
        'severity', 'info',
        'message', format('Color (%s SRM) is darker than style maximum (%s). Consider reducing dark malts.', v_recipe.est_srm, v_style.srm_max),
        'parameter', 'srm'
      );
    END IF;
  END IF;

  -- Check yeast temperature range
  IF v_yeast IS NOT NULL AND v_recipe.fermentation_schedule IS NOT NULL THEN
    DECLARE
      v_ferm_temp INTEGER;
    BEGIN
      v_ferm_temp := (v_recipe.fermentation_schedule->0->>'temperature_f')::INTEGER;
      IF v_ferm_temp IS NOT NULL THEN
        IF v_ferm_temp < v_yeast.temp_min_f THEN
          v_suggestions := v_suggestions || jsonb_build_object(
            'category', 'fermentation',
            'severity', 'warning',
            'message', format('Fermentation temp (%s F) is below yeast minimum (%s F). May cause slow/stuck fermentation.', v_ferm_temp, v_yeast.temp_min_f),
            'parameter', 'fermentation_temp'
          );
        ELSIF v_ferm_temp > v_yeast.temp_max_f THEN
          v_suggestions := v_suggestions || jsonb_build_object(
            'category', 'fermentation',
            'severity', 'warning',
            'message', format('Fermentation temp (%s F) is above yeast maximum (%s F). May cause off-flavors.', v_ferm_temp, v_yeast.temp_max_f),
            'parameter', 'fermentation_temp'
          );
        END IF;
      END IF;
    END;
  END IF;

  -- Check grain bill composition
  IF v_grain_bill.total_weight > 0 THEN
    DECLARE
      v_base_pct NUMERIC;
    BEGIN
      v_base_pct := v_grain_bill.base_weight * 100.0 / v_grain_bill.total_weight;
      IF v_base_pct < 70 THEN
        v_suggestions := v_suggestions || jsonb_build_object(
          'category', 'grain_bill',
          'severity', 'info',
          'message', format('Base malt is only %.0f%% of grain bill. Consider 70-90%% for most styles.', v_base_pct),
          'parameter', 'base_malt_percentage'
        );
      END IF;
    END;
  END IF;

  -- Check water chemistry for hoppy styles
  IF v_water IS NOT NULL AND v_style IS NOT NULL THEN
    IF v_style.category ILIKE '%IPA%' OR v_style.category ILIKE '%Pale%' THEN
      IF v_water.sulfate_ppm / NULLIF(v_water.chloride_ppm, 0) < 1.5 THEN
        v_suggestions := v_suggestions || jsonb_build_object(
          'category', 'water_chemistry',
          'severity', 'info',
          'message', format('Sulfate:Chloride ratio (%.1f:1) is low for hoppy style. Consider 2:1 or higher.', v_water.sulfate_ppm / NULLIF(v_water.chloride_ppm, 1)),
          'parameter', 'sulfate_chloride_ratio'
        );
      END IF;
    END IF;
  END IF;

  -- Check mash temperature for fermentability
  IF v_recipe.mash_temp_f IS NOT NULL AND v_yeast IS NOT NULL THEN
    IF v_recipe.mash_temp_f > 156 AND v_recipe.target_attenuation > 75 THEN
      v_suggestions := v_suggestions || jsonb_build_object(
        'category', 'mash',
        'severity', 'warning',
        'message', format('High mash temp (%s F) may limit fermentability. Target attenuation (%.0f%%) may not be achievable.', v_recipe.mash_temp_f, v_recipe.target_attenuation),
        'parameter', 'mash_temp'
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'recipe_id', p_recipe_id,
    'recipe_name', v_recipe.name,
    'suggestion_count', jsonb_array_length(v_suggestions),
    'suggestions', v_suggestions
  );
END;
$$;

-- ============================================================================
-- BATCH ANALYSIS FUNCTIONS
-- ============================================================================

-- Function to compare batch actuals vs recipe targets
CREATE OR REPLACE FUNCTION analyze_batch_performance(p_batch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'batch_id', b.id,
    'batch_number', b.batch_number,
    'status', b.status,
    'recipe', jsonb_build_object(
      'id', r.id,
      'name', r.name,
      'target_og', re.est_og,
      'target_fg', re.est_fg,
      'target_abv', re.est_abv
    ),
    'actuals', jsonb_build_object(
      'og', (
        SELECT (e->>'measurements')::jsonb->0->>'value'
        FROM brew_logs bl
        JOIN brew_log_batches blb ON blb.brew_log_id = bl.id
        CROSS JOIN jsonb_array_elements(bl.events) e
        WHERE blb.batch_id = b.id
        AND e->>'phase' = 'ko_end'
        LIMIT 1
      ),
      'fg', b.actual_fg,
      'abv', b.actual_abv
    ),
    'variances', jsonb_build_object(
      'fg_variance', CASE WHEN b.actual_fg IS NOT NULL AND re.est_fg IS NOT NULL
        THEN ROUND((b.actual_fg - re.est_fg)::numeric, 3) END,
      'abv_variance', CASE WHEN b.actual_abv IS NOT NULL AND re.est_abv IS NOT NULL
        THEN ROUND((b.actual_abv - re.est_abv)::numeric, 1) END
    ),
    'fermentation', jsonb_build_object(
      'planned_start', b.planned_start_date,
      'readings_count', (SELECT COUNT(*) FROM batch_readings WHERE batch_id = b.id),
      'latest_reading', (
        SELECT jsonb_build_object(
          'recorded_at', br.recorded_at,
          'measurements', br.measurements
        )
        FROM batch_readings br
        WHERE br.batch_id = b.id
        ORDER BY br.recorded_at DESC
        LIMIT 1
      )
    )
  ) INTO v_result
  FROM batches b
  LEFT JOIN recipes r ON r.id = b.recipe_id
  LEFT JOIN recipes_with_estimates re ON re.id = r.id
  WHERE b.id = p_batch_id;

  RETURN COALESCE(v_result, jsonb_build_object('error', 'Batch not found'));
END;
$$;

-- ============================================================================
-- INVENTORY ANALYSIS FUNCTIONS
-- ============================================================================

-- Function to get inventory overview for AI
CREATE OR REPLACE FUNCTION get_inventory_overview()
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'finished_goods', (
      SELECT jsonb_agg(jsonb_build_object(
        'brand', fg.brand_name,
        'package_type', fg.package_name,
        'total_quantity', fg.total_qty,
        'available_quantity', fg.available_qty
      ))
      FROM (
        SELECT
          br.name as brand_name,
          pt.name as package_name,
          SUM(bi.quantity) as total_qty,
          SUM(bi.quantity) - COALESCE(SUM(
            (SELECT SUM(a.quantity) FROM allocations a
             WHERE a.source_type = 'finished_good'
             AND a.source_id = fg.id
             AND a.status IN ('planned', 'completed'))
          ), 0) as available_qty
        FROM bin_inventory bi
        JOIN finished_goods fg ON fg.id = bi.finished_good_id
        JOIN brands br ON br.id = fg.brand_id
        JOIN package_types pt ON pt.id = fg.package_type_id
        GROUP BY br.id, br.name, pt.id, pt.name
      ) fg
    ),
    'raw_materials', (
      SELECT jsonb_agg(jsonb_build_object(
        'item_name', ri.name,
        'item_type', ri.type,
        'quantity_available', ri.available,
        'unit', ri.unit
      ))
      FROM (
        SELECT
          ii.name,
          ii.catalog_type as type,
          ii.unit,
          COALESCE(SUM(il.quantity), 0) - COALESCE(SUM(
            (SELECT SUM(a.quantity) FROM allocations a
             WHERE a.source_type = 'inventory_lot'
             AND a.source_id = il.id
             AND a.status IN ('planned', 'completed'))
          ), 0) as available
        FROM inventory_items ii
        LEFT JOIN inventory_lots il ON il.inventory_item_id = ii.id
        GROUP BY ii.id, ii.name, ii.catalog_type, ii.unit
      ) ri
      WHERE ri.available > 0
    ),
    'batches_in_progress', (
      SELECT jsonb_agg(jsonb_build_object(
        'batch_number', b.batch_number,
        'recipe_name', r.name,
        'status', b.status,
        'planned_start', b.planned_start_date
      ))
      FROM batches b
      JOIN recipes r ON r.id = b.recipe_id
      WHERE b.status NOT IN ('completed', 'cancelled')
      ORDER BY b.planned_start_date
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ============================================================================
-- SCHEMA INTROSPECTION FUNCTION
-- ============================================================================

-- Function for AI to get complete schema information
CREATE OR REPLACE FUNCTION get_ai_schema_context(p_domain TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN (
    SELECT jsonb_build_object(
      'tables', jsonb_agg(jsonb_build_object(
        'table_name', sr.table_name,
        'description', sr.description,
        'domain', sr.domain,
        'relationships', sr.relationships,
        'key_fields', sr.key_fields,
        'state_machine', sr.state_machine,
        'query_examples', sr.query_examples,
        'ai_context', sr.ai_context,
        'calculated_fields', sr.calculated_fields
      ) ORDER BY sr.domain, sr.table_name)
    )
    FROM _schema_registry sr
    WHERE p_domain IS NULL OR sr.domain = p_domain
  );
END;
$$;

-- ============================================================================
-- UPDATE SCHEMA REGISTRY WITH AI CONTEXT
-- ============================================================================

-- Update recipes entry with AI context
UPDATE _schema_registry
SET
  ai_context = jsonb_build_object(
    'purpose', 'Defines brewing parameters, ingredients, and process for making beer',
    'ai_actions', jsonb_build_array(
      'analyze_recipe_style_compliance',
      'get_recipe_summary',
      'suggest_recipe_improvements'
    ),
    'key_relationships', jsonb_build_object(
      'style', 'beer_styles - BJCP guidelines for the target style',
      'ingredients', 'recipe_malts, recipe_hops - junction tables for ingredients',
      'batches', 'batches - production instances of this recipe'
    )
  ),
  calculated_fields = jsonb_build_array(
    jsonb_build_object('field', 'est_og', 'source', 'recipes_with_estimates', 'formula', 'SUM(malt.ppg * weight) * efficiency / volume'),
    jsonb_build_object('field', 'est_fg', 'source', 'recipes_with_estimates', 'formula', 'OG adjusted by attenuation'),
    jsonb_build_object('field', 'est_abv', 'source', 'recipes_with_estimates', 'formula', '(OG - FG) * 131.25'),
    jsonb_build_object('field', 'est_ibu', 'source', 'recipes_with_estimates', 'formula', 'Tinseth formula per hop'),
    jsonb_build_object('field', 'est_srm', 'source', 'recipes_with_estimates', 'formula', 'Morey equation from grain color')
  )
WHERE table_name = 'recipes';

-- Update batches entry with AI context
UPDATE _schema_registry
SET
  ai_context = jsonb_build_object(
    'purpose', 'Tracks cold-side production from fermentation through packaging',
    'ai_actions', jsonb_build_array('analyze_batch_performance'),
    'key_relationships', jsonb_build_object(
      'recipe', 'recipes - the brewing formula used',
      'brew_logs', 'brew_log_batches - hot-side brewing data',
      'vessel', 'vessels_with_current_batch - current fermentation vessel'
    ),
    'state_machine', jsonb_build_object(
      'field', 'status',
      'states', jsonb_build_array('planned', 'fermenting', 'conditioning', 'packaging', 'completed', 'cancelled'),
      'typical_flow', 'planned -> fermenting -> conditioning -> packaging -> completed'
    )
  )
WHERE table_name = 'batches';

-- Insert AI context for key catalog tables
UPDATE _schema_registry
SET ai_context = jsonb_build_object(
  'purpose', 'BJCP beer style guidelines with OG/FG/IBU/SRM/ABV ranges',
  'ai_usage', 'Compare recipe estimates against style guidelines for compliance'
)
WHERE table_name = 'beer_styles';

UPDATE _schema_registry
SET ai_context = jsonb_build_object(
  'purpose', 'Yeast strain catalog with fermentation characteristics',
  'key_fields_for_ai', jsonb_build_array('attenuation_min', 'attenuation_max', 'temp_min_f', 'temp_max_f', 'flocculation'),
  'ai_usage', 'Validate fermentation temp against yeast range, estimate attenuation'
)
WHERE table_name = 'yeasts';

UPDATE _schema_registry
SET ai_context = jsonb_build_object(
  'purpose', 'Water chemistry profiles for brewing',
  'key_fields_for_ai', jsonb_build_array('calcium_ppm', 'sulfate_ppm', 'chloride_ppm'),
  'ai_usage', 'Analyze sulfate:chloride ratio for style appropriateness'
)
WHERE table_name = 'water_profiles';

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON FUNCTION analyze_recipe_style_compliance IS 'AI function: Compares recipe estimates against BJCP style guidelines';
COMMENT ON FUNCTION get_recipe_summary IS 'AI function: Returns comprehensive recipe data in a structured format for AI analysis';
COMMENT ON FUNCTION suggest_recipe_improvements IS 'AI function: Analyzes recipe and suggests improvements based on brewing best practices';
COMMENT ON FUNCTION analyze_batch_performance IS 'AI function: Compares batch actuals vs recipe targets';
COMMENT ON FUNCTION get_inventory_overview IS 'AI function: Returns current inventory status for finished goods and raw materials';
COMMENT ON FUNCTION get_ai_schema_context IS 'AI function: Returns schema registry information for AI agent context';
