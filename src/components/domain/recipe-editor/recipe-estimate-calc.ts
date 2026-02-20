/**
 * Client-side recipe estimate calculations.
 *
 * Ports the SQL formulas from `recipes_with_estimates` view (migration 00098)
 * to TypeScript for live sidebar updates in the recipe editor.
 *
 * Formulas:
 * - OG:  1 + (totalPoints * efficiency / 100) / batchGal / 1000
 * - FG:  1 + (OG - 1) * (1 - attenuation / 100)
 * - ABV: (OG - 1) * 1000 * (attenuation / 100) * 131.25 / 1000
 * - IBU: weightedIbuFactor * 74.89 / batchGal  (Tinseth timing factors)
 * - SRM: 1.4922 * (mcuSum / batchGal) ^ 0.6859  (Morey equation)
 */

// =============================================================================
// Types
// =============================================================================

/** Grain bill item shape for estimate calculations */
export interface EstimateGrainItem {
  weight_lbs: number;
  /** Points per pound per gallon — falls back to 36 if missing */
  potential_ppg?: number | null;
  /** Color in Lovibond — falls back to 2 if missing */
  color_lovibond?: number | null;
}

/** Hop schedule item shape for estimate calculations */
export interface EstimateHopItem {
  weight_oz: number;
  /** Alpha acid percentage — falls back to 10 if missing */
  alpha_acid?: number | null;
  timing: string;
  boil_time_min?: number | null;
}

export interface RecipeEstimateInputs {
  grainItems: EstimateGrainItem[];
  hopItems: EstimateHopItem[];
  /** Batch size in barrels */
  batchSizeBbl?: number | null;
  /** Recipe volume in barrels (fallback if batchSizeBbl not set) */
  volumeBbl?: number | null;
  /** Mash efficiency percentage (default: 75) */
  mashEfficiency?: number | null;
  /** Target attenuation percentage (default: 75) */
  targetAttenuation?: number | null;
}

export interface RecipeEstimates {
  og: number | null;
  fg: number | null;
  abv: number | null;
  ibu: number | null;
  srm: number | null;
}

// =============================================================================
// Constants
// =============================================================================

/** Gallons per barrel */
const GAL_PER_BBL = 31;

/** Default potential PPG for grains without catalog data */
const DEFAULT_PPG = 36;

/** Default color in Lovibond for grains without catalog data */
const DEFAULT_COLOR = 2;

/** Default mash efficiency percentage */
const DEFAULT_EFFICIENCY = 75;

/** Default attenuation percentage */
const DEFAULT_ATTENUATION = 75;

/** Default alpha acid percentage for hops without catalog data */
const DEFAULT_ALPHA = 10;

// =============================================================================
// IBU Timing Factors (Tinseth approximation)
// =============================================================================

/**
 * Returns the utilization factor for a hop addition based on timing and boil time.
 * Matches the SQL CASE expression in the recipes_with_estimates view.
 */
export function getHopUtilizationFactor(
  timing: string,
  boilTimeMin?: number | null
): number {
  switch (timing) {
    case "boil": {
      const bt = boilTimeMin ?? 60;
      if (bt >= 60) return 0.27;
      if (bt >= 45) return 0.24;
      if (bt >= 30) return 0.20;
      if (bt >= 15) return 0.14;
      if (bt >= 10) return 0.10;
      if (bt >= 5) return 0.05;
      return 0.02;
    }
    case "first_wort":
      return 0.10;
    case "whirlpool":
      return 0.05;
    case "mash":
      return 0.08;
    default:
      // dry_hop, post-fermentation, etc. — no bitterness
      return 0;
  }
}

// =============================================================================
// Main Calculation
// =============================================================================

/**
 * Calculate recipe estimates from grain bill, hop schedule, and recipe parameters.
 * Returns null for any value that cannot be computed (e.g., empty grain bill).
 */
export function calculateEstimates(inputs: RecipeEstimateInputs): RecipeEstimates {
  const batchBbl = inputs.batchSizeBbl || inputs.volumeBbl || 1;
  const batchGal = batchBbl * GAL_PER_BBL;
  const efficiency = inputs.mashEfficiency ?? DEFAULT_EFFICIENCY;
  const attenuation = inputs.targetAttenuation ?? DEFAULT_ATTENUATION;

  // Grain totals
  const totalGrainLbs = inputs.grainItems.reduce((sum, g) => sum + g.weight_lbs, 0);
  const totalPoints = inputs.grainItems.reduce(
    (sum, g) => sum + g.weight_lbs * (g.potential_ppg ?? DEFAULT_PPG),
    0
  );
  const mcuSum = inputs.grainItems.reduce(
    (sum, g) => sum + g.weight_lbs * (g.color_lovibond ?? DEFAULT_COLOR),
    0
  );

  // Hop IBU factor
  const weightedIbuFactor = inputs.hopItems.reduce((sum, h) => {
    const alpha = h.alpha_acid ?? DEFAULT_ALPHA;
    const utilization = getHopUtilizationFactor(h.timing, h.boil_time_min);
    return sum + h.weight_oz * alpha * utilization;
  }, 0);

  // OG: 1 + (totalPoints * efficiency / 100) / batchGal / 1000
  let og: number | null = null;
  if (totalGrainLbs > 0 && batchGal > 0) {
    og = round(1 + (totalPoints * efficiency) / 100 / batchGal / 1000, 3);
  }

  // FG: OG adjusted by attenuation
  let fg: number | null = null;
  if (og !== null) {
    fg = round(1 + (og - 1) * (1 - attenuation / 100), 3);
  }

  // ABV: gravity points * attenuation * 131.25 / 1000
  let abv: number | null = null;
  if (totalGrainLbs > 0 && batchGal > 0) {
    abv = round(
      (totalPoints * efficiency) / 100 / batchGal / 1000 * (attenuation / 100) * 131.25,
      1
    );
  }

  // IBU: weightedIbuFactor * 74.89 / batchGal
  let ibu: number | null = null;
  if (weightedIbuFactor > 0 && batchGal > 0) {
    ibu = Math.round(weightedIbuFactor * 74.89 / batchGal);
  }

  // SRM: Morey equation — 1.4922 * (mcuSum / batchGal) ^ 0.6859
  let srm: number | null = null;
  if (mcuSum > 0 && batchGal > 0) {
    srm = round(1.4922 * Math.pow(mcuSum / batchGal, 0.6859), 1);
  }

  return { og, fg, abv, ibu, srm };
}

// =============================================================================
// Helpers
// =============================================================================

/** Round to N decimal places */
function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}
