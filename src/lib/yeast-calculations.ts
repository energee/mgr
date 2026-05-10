/**
 * Yeast Calculations Library
 *
 * Formulas for viability decay, cell counts, and pitching rates.
 * Used for yeast management and fermentation planning.
 */

// =============================================================================
// Types
// =============================================================================

export type YeastForm = "liquid" | "dry";

export type ViabilityResult = {
  viability: number;
  status: "excellent" | "good" | "marginal" | "low" | "inactive";
  daysOld: number;
}

export type PitchingRateResult = {
  cellsNeeded: number; // thousands of cells
  packagesNeeded: number;
  starterRecommended: boolean;
  starterVolumeMl: number | null;
  lbsNeeded?: number;
}

export type CellCountEstimate = {
  cellsThousand: number;
  confidence: "high" | "medium" | "low";
  notes: string;
}

// =============================================================================
// Viability Decay
// =============================================================================

/**
 * Daily viability decay rate by yeast form.
 *
 * Liquid yeast: ~2% per day (decayRate = 0.98)
 * Dry yeast: ~0.5% per day (decayRate = 0.995)
 */
const VIABILITY_DECAY_RATES: Record<YeastForm, number> = {
  liquid: 0.98,
  dry: 0.995,
};

/**
 * Calculate viability decay over time.
 *
 * Liquid yeast: ~2-4% per day (we use 2% as conservative estimate)
 * Dry yeast: ~0.5% per day when stored properly
 *
 * Formula: viability = initialViability * (decayRate ^ daysOld)
 */
export function calculateViabilityDecay(
  initialViability: number,
  daysOld: number,
  form: YeastForm = "liquid"
): ViabilityResult {
  const decayRate = VIABILITY_DECAY_RATES[form];
  const viability = Math.max(0, initialViability * Math.pow(decayRate, daysOld));

  return {
    viability: Math.round(viability * 100) / 100,
    status: getViabilityStatus(viability),
    daysOld,
  };
}

/**
 * Get viability status based on percentage.
 */
export function getViabilityStatus(
  viability: number
): "excellent" | "good" | "marginal" | "low" | "inactive" {
  if (viability >= 90) return "excellent";
  if (viability >= 75) return "good";
  if (viability >= 50) return "marginal";
  if (viability >= 25) return "low";
  return "inactive";
}

/**
 * Calculate days until viability drops below threshold.
 */
export function daysUntilViabilityThreshold(
  currentViability: number,
  threshold: number,
  form: YeastForm = "liquid"
): number {
  if (currentViability <= threshold) return 0;
  const decayRate = VIABILITY_DECAY_RATES[form];
  // viability = initial * rate^days
  // threshold = current * rate^days
  // log(threshold/current) = days * log(rate)
  // days = log(threshold/current) / log(rate)
  const days = Math.log(threshold / currentViability) / Math.log(decayRate);
  return Math.max(0, Math.floor(days));
}

// =============================================================================
// Cell Count Estimation
// =============================================================================

/**
 * Estimate cell count from liquid yeast package.
 *
 * Fresh liquid yeast pack: ~100 billion cells = 100,000,000 thousand cells
 * Dry yeast packet (11g): ~200 billion cells = 200,000,000 thousand cells
 *
 * @returns Cell count in thousands
 */
export function estimateCellsFromPackage(
  form: YeastForm,
  packageCount: number = 1,
  viability: number = 95
): CellCountEstimate {
  // Base cells in billions, then convert to thousands (* 1,000,000)
  const baseCellsBillion = form === "liquid" ? 100 : 200;
  const viableCellsBillion =
    baseCellsBillion * (viability / 100) * packageCount;
  const viableCellsThousand = viableCellsBillion * 1_000_000;

  return {
    cellsThousand: Math.round(viableCellsThousand * 10) / 10,
    confidence: viability > 80 ? "high" : viability > 50 ? "medium" : "low",
    notes:
      form === "liquid"
        ? `Based on ${packageCount} pack(s) at ${viability}% viability`
        : `Based on ${packageCount} packet(s) at ${viability}% viability`,
  };
}

const SLURRY_CELLS_BILLION_PER_ML: Record<"dense" | "medium" | "thin", number> = {
  dense: 1.0,
  medium: 0.5,
  thin: 0.25,
};

/**
 * Estimate cell count from harvested slurry.
 *
 * Dense slurry: ~1 billion cells per mL = 1,000,000 thousand per mL
 * Medium slurry: ~0.5 billion cells per mL = 500,000 thousand per mL
 * Thin slurry: ~0.25 billion cells per mL = 250,000 thousand per mL
 *
 * @returns Cell count in thousands
 */
export function estimateCellsFromSlurry(
  volumeMl: number,
  density: "dense" | "medium" | "thin" = "medium",
  viability: number = 85
): CellCountEstimate {
  // Cells per mL in billions, then convert result to thousands (* 1,000,000)
  const cellsPerMlBillion = SLURRY_CELLS_BILLION_PER_ML[density];
  const viableCellsBillion =
    volumeMl * cellsPerMlBillion * (viability / 100);
  const viableCellsThousand = viableCellsBillion * 1_000_000;

  return {
    cellsThousand: Math.round(viableCellsThousand * 10) / 10,
    confidence: "medium",
    notes: `Based on ${volumeMl}mL ${density} slurry at ${viability}% viability`,
  };
}

// =============================================================================
// Pitching Rate Calculations
// =============================================================================

/**
 * Standard pitching rates (million cells per mL per degree Plato).
 *
 * - Ale: 0.75 million cells/mL/°P
 * - Lager: 1.5 million cells/mL/°P (double for cold fermentation)
 * - High gravity (>1.065): 1.0-1.25 million cells/mL/°P
 */
export type FermentationType = "ale" | "lager" | "high_gravity";

const PITCHING_RATES: Record<FermentationType, number> = {
  ale: 0.75,
  lager: 1.5,
  high_gravity: 1.0,
};

/**
 * Calculate required pitching rate and recommendations.
 *
 * The formula uses million cells/mL/degP x volume x gravity, then converts
 * the result to thousands. The intermediate result is in millions of cells:
 *   cellsMillions = volumeMl * gravityPlato * pitchingRate
 * Converting millions to thousands: multiply by 1,000.
 *
 * @param volumeBbl - Batch volume in barrels
 * @param gravityPlato - Original gravity in Plato
 * @param fermentationType - Type of fermentation
 * @param availableCellsThousand - Available viable cells in thousands (optional)
 * @returns cellsNeeded in thousands
 */
export function calculatePitchingRate(
  volumeBbl: number,
  gravityPlato: number,
  fermentationType: FermentationType = "ale",
  availableCellsThousand?: number
): PitchingRateResult {
  // Convert BBL to mL (1 BBL = 117,348 mL)
  const volumeMl = volumeBbl * 117348;

  // Calculate cells needed in millions (pitching rate is million cells/mL/degP)
  const pitchingRate = PITCHING_RATES[fermentationType];
  const cellsNeededMillions = volumeMl * gravityPlato * pitchingRate;

  // Convert millions to thousands (* 1,000)
  const cellsNeededThousand = cellsNeededMillions * 1_000;

  // Calculate packages needed (assuming 100B = 100,000,000 thousand cells per liquid pack)
  const cellsPerPackThousand = 100_000_000;
  const packagesNeeded = Math.ceil(cellsNeededThousand / cellsPerPackThousand);

  // Determine if starter is recommended
  let starterRecommended = false;
  let starterVolumeMl: number | null = null;

  if (availableCellsThousand !== undefined) {
    const shortageThousand = cellsNeededThousand - availableCellsThousand;
    // 50B = 50,000,000 thousand
    if (shortageThousand > 50_000_000) {
      starterRecommended = true;
      // Rough estimate: 100mL starter per 10B cells needed
      // 10B = 10,000,000 thousand
      const shortageBillion = shortageThousand / 1_000_000;
      starterVolumeMl =
        Math.ceil((shortageBillion * 100) / 10) * 100; // Round to nearest 100mL
    }
  } else if (packagesNeeded > 2) {
    // Without knowing available cells, recommend starter if >2 packs needed
    starterRecommended = true;
    starterVolumeMl = 2000; // Default 2L starter
  }

  return {
    cellsNeeded: Math.round(cellsNeededThousand * 10) / 10,
    packagesNeeded,
    starterRecommended,
    starterVolumeMl,
  };
}

// =============================================================================
// Gravity Conversions
// =============================================================================

/**
 * Convert specific gravity to Plato.
 */
export function sgToPlato(sg: number): number {
  // Simplified formula (accurate for normal brewing range)
  return (-1 * 616.868 + 1111.14 * sg - 630.272 * sg ** 2 + 135.997 * sg ** 3);
}

/**
 * Convert Plato to specific gravity.
 */
export function platoToSg(plato: number): number {
  return 1 + plato / (258.6 - (plato / 258.2) * 227.1);
}

// =============================================================================
// Generation and Lineage
// =============================================================================

/**
 * Maximum recommended generations before buying fresh yeast.
 * After this many repitches, mutations and off-flavors may occur.
 */
export const MAX_RECOMMENDED_GENERATIONS: Record<string, number> = {
  default: 8,
  lager: 10, // Lager strains are generally hardier
  belgian: 6, // Belgian strains can mutate faster
  brett: 12, // Brettanomyces is very stable
};

/**
 * Check if yeast should be replaced based on generation count.
 */
export function shouldReplaceYeast(
  generation: number,
  strainType?: string
): { replace: boolean; reason: string | null } {
  const maxGen =
    MAX_RECOMMENDED_GENERATIONS[strainType?.toLowerCase() || "default"] ||
    MAX_RECOMMENDED_GENERATIONS.default;

  if (generation >= maxGen) {
    return {
      replace: true,
      reason: `Generation ${generation} exceeds recommended maximum of ${maxGen} for ${strainType || "this strain"}.`,
    };
  }

  if (generation >= maxGen - 2) {
    return {
      replace: false,
      reason: `Generation ${generation} is approaching recommended maximum of ${maxGen}. Consider fresh yeast soon.`,
    };
  }

  return { replace: false, reason: null };
}

// =============================================================================
// Harvest Estimation
// =============================================================================

/**
 * Estimate harvestable yeast from a fermentation.
 *
 * Typical recovery rates:
 * - Cone fermenters: 1-2L per BBL of wort
 * - Flat-bottom: 0.5-1L per BBL
 * - High flocculation strains yield more
 */
export function estimateHarvestVolume(
  batchVolumeBbl: number,
  flocculation: "low" | "medium" | "high" = "medium",
  vesselType: "cone" | "flat" = "cone"
): { volumeMlMin: number; volumeMlMax: number } {
  const baseRates =
    vesselType === "cone"
      ? { min: 1000, max: 2000 } // mL per BBL
      : { min: 500, max: 1000 };

  const flocMultiplier =
    flocculation === "high" ? 1.3 : flocculation === "low" ? 0.7 : 1.0;

  return {
    volumeMlMin: Math.round(batchVolumeBbl * baseRates.min * flocMultiplier),
    volumeMlMax: Math.round(batchVolumeBbl * baseRates.max * flocMultiplier),
  };
}

// =============================================================================
// Weight-Based Pitching
// =============================================================================

/**
 * Calculate how many lbs to pitch from a brink given batch requirements.
 *
 * @param cellsNeededThousand - Total cells needed (thousands)
 * @param cellDensityThousandPerLb - Cell density of brink (thousands per lb)
 * @param viability - Current viability percentage (0-100)
 * @returns Weight in lbs to pitch, rounded up to nearest 0.1 lb
 */
export function calculatePitchWeightLbs(
  cellsNeededThousand: number,
  cellDensityThousandPerLb: number,
  viability: number
): number {
  if (cellDensityThousandPerLb <= 0 || viability <= 0) return 0;
  const viableCellsPerLb = cellDensityThousandPerLb * (viability / 100);
  return Math.ceil((cellsNeededThousand / viableCellsPerLb) * 10) / 10;
}

// =============================================================================
// Cell Count Formatting
// =============================================================================

/**
 * Format cell count for display.
 *
 * Converts a cell count in thousands to a human-readable string:
 * - >= 1,000,000 thousand -> billions (e.g. "1.5B")
 * - >= 1,000 thousand -> millions (e.g. "450M")
 * - < 1,000 thousand -> thousands (e.g. "500K")
 *
 * @param thousand - Cell count in thousands
 * @returns Human-readable string like "450M" or "750K"
 */
export function formatCellCount(thousand: number): string {
  if (thousand >= 1_000_000) {
    const billions = thousand / 1_000_000;
    return `${Number(billions.toFixed(1))}B`;
  }
  if (thousand >= 1_000) {
    const millions = thousand / 1_000;
    return `${Number(millions.toFixed(1))}M`;
  }
  return `${Number(thousand.toFixed(0))}K`;
}

// =============================================================================
// Post-Harvest Viability
// =============================================================================

/**
 * Estimate post-harvest viability.
 *
 * Harvested yeast typically starts at 85-95% viability
 * depending on fermentation conditions and handling.
 */
export function estimatePostHarvestViability(
  fermentationTempF: number,
  alcoholPercent: number,
  daysInFermenter: number
): number {
  let viability = 95;

  // High temp stress (above 72°F for ales, above 55°F for lagers)
  if (fermentationTempF > 72) {
    viability -= (fermentationTempF - 72) * 0.5;
  }

  // Alcohol toxicity (above 6% starts affecting viability)
  if (alcoholPercent > 6) {
    viability -= (alcoholPercent - 6) * 2;
  }

  // Extended contact time (beyond 14 days)
  if (daysInFermenter > 14) {
    viability -= (daysInFermenter - 14) * 0.5;
  }

  return Math.max(50, Math.min(95, Math.round(viability)));
}
