/**
 * Yeast Calculations Utility
 *
 * Provides functions for:
 * - Viability decay calculation
 * - Pitching rate calculation
 * - Cell count estimation
 * - Generation tracking
 */

/**
 * Calculate current viability based on time since harvest.
 * Viability decays approximately 3% per day at refrigerator temps (34-40°F).
 *
 * @param initialViability - Initial viability percentage (0-100)
 * @param harvestDate - Date yeast was harvested
 * @param now - Current date (defaults to now)
 * @returns Current estimated viability percentage
 */
export function calculateCurrentViability(
  initialViability: number,
  harvestDate: Date,
  now: Date = new Date()
): number {
  const daysDiff = Math.floor(
    (now.getTime() - harvestDate.getTime()) / (1000 * 60 * 60 * 24)
  );
  const decayRate = 0.03; // 3% per day
  const currentViability = initialViability * Math.pow(1 - decayRate, daysDiff);
  return Math.max(0, Math.round(currentViability * 10) / 10);
}

/**
 * Calculate pitching rate in million cells per mL per degree Plato.
 * Standard rates:
 * - Ale: 0.75-1.0 million cells/mL/°P
 * - Lager: 1.5-2.0 million cells/mL/°P
 * - High gravity: 1.0-1.5 million cells/mL/°P
 *
 * @param cellCountBillions - Total cell count in billions
 * @param volumeLiters - Wort volume in liters
 * @param gravityPlato - Original gravity in Plato
 * @returns Pitching rate in million cells/mL/°P
 */
export function calculatePitchingRate(
  cellCountBillions: number,
  volumeLiters: number,
  gravityPlato: number
): number {
  const cellsPerML = (cellCountBillions * 1e9) / (volumeLiters * 1000);
  const millionCellsPerML = cellsPerML / 1e6;
  return Math.round((millionCellsPerML / gravityPlato) * 100) / 100;
}

/**
 * Calculate required cell count for target pitching rate.
 *
 * @param volumeLiters - Wort volume in liters
 * @param gravityPlato - Original gravity in Plato
 * @param targetRate - Target pitching rate (million cells/mL/°P)
 * @returns Required cell count in billions
 */
export function calculateRequiredCells(
  volumeLiters: number,
  gravityPlato: number,
  targetRate: number
): number {
  const requiredCellsPerML = targetRate * gravityPlato * 1e6;
  const totalCells = requiredCellsPerML * volumeLiters * 1000;
  return Math.round((totalCells / 1e9) * 10) / 10;
}

/**
 * Estimate cell count after propagation.
 * Growth factor depends on starter size and method:
 * - Stir plate: 1.4-1.8 billion cells/g extract
 * - Simple starter: 1.0-1.4 billion cells/g extract
 * - Shaking: 1.2-1.6 billion cells/g extract
 *
 * @param initialCells - Starting cell count in billions
 * @param starterVolumeLiters - Starter volume in liters
 * @param gravityPlato - Starter gravity in Plato
 * @param method - Propagation method
 * @returns Estimated cell count after propagation in billions
 */
export function estimatePropagation(
  initialCells: number,
  starterVolumeLiters: number,
  gravityPlato: number,
  method: "stir_plate" | "simple" | "shaking" = "stir_plate"
): number {
  // Extract grams = volume (L) × gravity (°P) × 10
  const extractGrams = starterVolumeLiters * gravityPlato * 10;

  // Growth rates based on method
  const growthRates = {
    stir_plate: 1.6, // billion cells per gram extract
    simple: 1.2,
    shaking: 1.4,
  };

  const growthRate = growthRates[method];
  const newCells = extractGrams * growthRate;

  // Total = initial + growth, but limited by initial cell count
  // Can only grow about 4x initial population per step
  const maxGrowth = initialCells * 4;
  const growth = Math.min(newCells, maxGrowth);

  return Math.round((initialCells + growth) * 10) / 10;
}

/**
 * Convert Plato to Specific Gravity.
 */
export function platoToSg(plato: number): number {
  return 1 + plato / (258.6 - (plato / 258.2) * 227.1);
}

/**
 * Convert Specific Gravity to Plato.
 */
export function sgToPlato(sg: number): number {
  return -676.67 + 1286.4 * sg - 800.47 * sg * sg + 190.74 * sg * sg * sg;
}

/**
 * Get recommended pitching rate for fermentation type.
 */
export function getRecommendedPitchingRate(
  fermentationType: "ale" | "lager" | "high_gravity"
): { min: number; max: number; unit: string } {
  const rates = {
    ale: { min: 0.75, max: 1.0, unit: "million cells/mL/°P" },
    lager: { min: 1.5, max: 2.0, unit: "million cells/mL/°P" },
    high_gravity: { min: 1.0, max: 1.5, unit: "million cells/mL/°P" },
  };
  return rates[fermentationType];
}

/**
 * Calculate viability status.
 */
export function getViabilityStatus(viability: number): {
  status: "excellent" | "good" | "fair" | "poor";
  color: "success" | "info" | "warning" | "error";
} {
  if (viability >= 90) return { status: "excellent", color: "success" };
  if (viability >= 75) return { status: "good", color: "info" };
  if (viability >= 50) return { status: "fair", color: "warning" };
  return { status: "poor", color: "error" };
}

/**
 * Estimate harvest yield from batch.
 * Typical yields:
 * - Light ale: 50-100 billion cells per liter
 * - Strong ale: 75-150 billion cells per liter
 * - Lager: 100-200 billion cells per liter
 *
 * @param volumeLiters - Batch volume in liters
 * @param og - Original gravity (Plato)
 * @param fg - Final gravity (Plato)
 * @returns Estimated harvest yield in billions of cells
 */
export function estimateHarvestYield(
  volumeLiters: number,
  og: number,
  fg: number
): number {
  // Higher attenuation = more cell growth
  const attenuation = ((og - fg) / og) * 100;

  // Base yield depends on fermentation vigor
  let baseYield = 75; // billion cells per liter
  if (og > 15) baseYield = 100; // stronger beers
  if (attenuation > 80) baseYield *= 1.2; // high attenuation bonus

  return Math.round(baseYield * volumeLiters);
}
