/**
 * Water Chemistry Library
 *
 * Provides calculations for brewing water chemistry:
 * - Salt additions to reach target water profiles
 * - Ion contributions from common brewing salts
 * - Residual alkalinity and mash pH estimation
 */

// =============================================================================
// Types
// =============================================================================

export interface WaterProfile {
  calcium_ppm: number;
  magnesium_ppm: number;
  sodium_ppm: number;
  sulfate_ppm: number;
  chloride_ppm: number;
  bicarbonate_ppm: number;
}

export interface SaltAdditions {
  gypsum_g: number; // CaSO4
  calcium_chloride_g: number; // CaCl2
  epsom_salt_g: number; // MgSO4
  baking_soda_g: number; // NaHCO3
  chalk_g: number; // CaCO3
  table_salt_g: number; // NaCl
  magnesium_chloride_g: number; // MgCl2
}

export interface GrainBillItem {
  name: string;
  color_srm: number;
  weight_lb: number;
}

// =============================================================================
// Salt Ion Contributions (ppm per gram per gallon)
// =============================================================================

export const SALT_CONTRIBUTIONS = {
  gypsum: {
    name: "Gypsum (CaSO4)",
    calcium: 61.5,
    sulfate: 147.4,
  },
  calcium_chloride: {
    name: "Calcium Chloride (CaCl2)",
    calcium: 72,
    chloride: 127,
  },
  epsom_salt: {
    name: "Epsom Salt (MgSO4)",
    magnesium: 26,
    sulfate: 103,
  },
  baking_soda: {
    name: "Baking Soda (NaHCO3)",
    sodium: 75,
    bicarbonate: 191,
  },
  chalk: {
    name: "Chalk (CaCO3)",
    calcium: 106,
    carbonate: 158,
  },
  table_salt: {
    name: "Table Salt (NaCl)",
    sodium: 104,
    chloride: 160,
  },
  magnesium_chloride: {
    name: "Magnesium Chloride (MgCl2)",
    magnesium: 31.6,
    chloride: 89.6,
  },
} as const;

// =============================================================================
// Common Water Profiles
// =============================================================================

export const COMMON_PROFILES: Record<string, WaterProfile & { name: string; description: string }> = {
  distilled: {
    name: "Distilled/RO",
    description: "Blank slate for building any profile",
    calcium_ppm: 0,
    magnesium_ppm: 0,
    sodium_ppm: 0,
    sulfate_ppm: 0,
    chloride_ppm: 0,
    bicarbonate_ppm: 0,
  },
  burton: {
    name: "Burton-on-Trent",
    description: "Classic English IPA water - very hoppy",
    calcium_ppm: 295,
    magnesium_ppm: 45,
    sodium_ppm: 55,
    sulfate_ppm: 725,
    chloride_ppm: 25,
    bicarbonate_ppm: 300,
  },
  pilsen: {
    name: "Pilsen",
    description: "Very soft water for pale lagers",
    calcium_ppm: 7,
    magnesium_ppm: 2,
    sodium_ppm: 2,
    sulfate_ppm: 5,
    chloride_ppm: 5,
    bicarbonate_ppm: 15,
  },
  dublin: {
    name: "Dublin",
    description: "High mineral content for stouts",
    calcium_ppm: 118,
    magnesium_ppm: 4,
    sodium_ppm: 12,
    sulfate_ppm: 54,
    chloride_ppm: 19,
    bicarbonate_ppm: 319,
  },
  dortmund: {
    name: "Dortmund",
    description: "Balanced water for export lagers",
    calcium_ppm: 225,
    magnesium_ppm: 40,
    sodium_ppm: 60,
    sulfate_ppm: 120,
    chloride_ppm: 60,
    bicarbonate_ppm: 220,
  },
  munich: {
    name: "Munich",
    description: "Moderate hardness for dark lagers",
    calcium_ppm: 76,
    magnesium_ppm: 18,
    sodium_ppm: 2,
    sulfate_ppm: 10,
    chloride_ppm: 2,
    bicarbonate_ppm: 152,
  },
  vienna: {
    name: "Vienna",
    description: "Good for amber lagers",
    calcium_ppm: 200,
    magnesium_ppm: 60,
    sodium_ppm: 8,
    sulfate_ppm: 125,
    chloride_ppm: 12,
    bicarbonate_ppm: 120,
  },
  london: {
    name: "London",
    description: "High carbonate for porters and milds",
    calcium_ppm: 90,
    magnesium_ppm: 5,
    sodium_ppm: 15,
    sulfate_ppm: 40,
    chloride_ppm: 30,
    bicarbonate_ppm: 260,
  },
};

// Target profiles for beer styles
export const STYLE_TARGETS: Record<string, WaterProfile & { name: string; ratio: string }> = {
  hoppy: {
    name: "Hoppy/IPA",
    ratio: "2:1 to 3:1",
    calcium_ppm: 100,
    magnesium_ppm: 10,
    sodium_ppm: 20,
    sulfate_ppm: 200,
    chloride_ppm: 70,
    bicarbonate_ppm: 50,
  },
  malty: {
    name: "Malty/Stout",
    ratio: "1:2",
    calcium_ppm: 100,
    magnesium_ppm: 10,
    sodium_ppm: 20,
    sulfate_ppm: 50,
    chloride_ppm: 100,
    bicarbonate_ppm: 150,
  },
  balanced: {
    name: "Balanced/Lager",
    ratio: "1:1",
    calcium_ppm: 50,
    magnesium_ppm: 5,
    sodium_ppm: 10,
    sulfate_ppm: 50,
    chloride_ppm: 50,
    bicarbonate_ppm: 50,
  },
  crisp: {
    name: "Crisp/Pilsner",
    ratio: "1:1",
    calcium_ppm: 40,
    magnesium_ppm: 5,
    sodium_ppm: 5,
    sulfate_ppm: 30,
    chloride_ppm: 30,
    bicarbonate_ppm: 20,
  },
};

// =============================================================================
// Calculation Functions
// =============================================================================

/**
 * Calculate sulfate to chloride ratio
 */
export function calculateSulfateChlorideRatio(sulfate: number, chloride: number): number {
  if (chloride === 0) return Infinity;
  return Math.round((sulfate / chloride) * 10) / 10;
}

/**
 * Get ratio description based on sulfate:chloride ratio
 */
export function getRatioDescription(ratio: number): { label: string; character: string } {
  if (ratio >= 2.5) return { label: "Very Hoppy", character: "Accentuates hop bitterness and dryness" };
  if (ratio >= 1.5) return { label: "Hoppy", character: "Enhances hop character" };
  if (ratio >= 0.8) return { label: "Balanced", character: "Neither malt nor hop emphasis" };
  if (ratio >= 0.4) return { label: "Malty", character: "Enhances malt sweetness" };
  return { label: "Very Malty", character: "Strong malt emphasis" };
}

/**
 * Calculate ion contribution from a salt addition
 */
export function calculateIonContribution(
  salt: keyof typeof SALT_CONTRIBUTIONS,
  grams: number,
  volumeGal: number
): Partial<WaterProfile> {
  const contributions = SALT_CONTRIBUTIONS[salt];
  const result: Partial<WaterProfile> = {};

  if ("calcium" in contributions) {
    result.calcium_ppm = (contributions.calcium * grams) / volumeGal;
  }
  if ("magnesium" in contributions) {
    result.magnesium_ppm = (contributions.magnesium * grams) / volumeGal;
  }
  if ("sodium" in contributions) {
    result.sodium_ppm = (contributions.sodium * grams) / volumeGal;
  }
  if ("sulfate" in contributions) {
    result.sulfate_ppm = (contributions.sulfate * grams) / volumeGal;
  }
  if ("chloride" in contributions) {
    result.chloride_ppm = (contributions.chloride * grams) / volumeGal;
  }
  if ("bicarbonate" in contributions) {
    result.bicarbonate_ppm = (contributions.bicarbonate * grams) / volumeGal;
  }
  if ("carbonate" in contributions) {
    result.bicarbonate_ppm = ((contributions.carbonate * grams) / volumeGal) * 1.22; // Convert carbonate to bicarbonate
  }

  return result;
}

/**
 * Calculate the resulting water profile after salt additions
 */
export function calculateResultingProfile(
  source: WaterProfile,
  additions: SaltAdditions,
  volumeGal: number
): WaterProfile {
  const result = { ...source };

  // Add each salt's contribution
  const salts: [keyof typeof SALT_CONTRIBUTIONS, number][] = [
    ["gypsum", additions.gypsum_g],
    ["calcium_chloride", additions.calcium_chloride_g],
    ["epsom_salt", additions.epsom_salt_g],
    ["baking_soda", additions.baking_soda_g],
    ["chalk", additions.chalk_g],
    ["table_salt", additions.table_salt_g],
    ["magnesium_chloride", additions.magnesium_chloride_g],
  ];

  for (const [salt, grams] of salts) {
    if (grams > 0) {
      const contribution = calculateIonContribution(salt, grams, volumeGal);
      for (const [ion, ppm] of Object.entries(contribution)) {
        result[ion as keyof WaterProfile] += ppm as number;
      }
    }
  }

  // Round all values
  return {
    calcium_ppm: Math.round(result.calcium_ppm * 10) / 10,
    magnesium_ppm: Math.round(result.magnesium_ppm * 10) / 10,
    sodium_ppm: Math.round(result.sodium_ppm * 10) / 10,
    sulfate_ppm: Math.round(result.sulfate_ppm * 10) / 10,
    chloride_ppm: Math.round(result.chloride_ppm * 10) / 10,
    bicarbonate_ppm: Math.round(result.bicarbonate_ppm * 10) / 10,
  };
}

/**
 * Simple calculation of suggested additions to reach target profile
 * Uses a greedy algorithm to match sulfate and chloride first
 */
export function calculateAdditions(
  source: WaterProfile,
  target: WaterProfile,
  volumeGal: number
): SaltAdditions {
  const additions: SaltAdditions = {
    gypsum_g: 0,
    calcium_chloride_g: 0,
    epsom_salt_g: 0,
    baking_soda_g: 0,
    chalk_g: 0,
    table_salt_g: 0,
    magnesium_chloride_g: 0,
  };

  // Calculate deltas
  const delta = {
    calcium: Math.max(0, target.calcium_ppm - source.calcium_ppm),
    magnesium: Math.max(0, target.magnesium_ppm - source.magnesium_ppm),
    sodium: Math.max(0, target.sodium_ppm - source.sodium_ppm),
    sulfate: Math.max(0, target.sulfate_ppm - source.sulfate_ppm),
    chloride: Math.max(0, target.chloride_ppm - source.chloride_ppm),
    bicarbonate: Math.max(0, target.bicarbonate_ppm - source.bicarbonate_ppm),
  };

  // Priority: Match sulfate first (using gypsum), then chloride (using CaCl2)
  // This is a simplified greedy approach

  // Add gypsum for sulfate (also adds calcium)
  if (delta.sulfate > 0) {
    const gramsNeeded = (delta.sulfate * volumeGal) / SALT_CONTRIBUTIONS.gypsum.sulfate;
    additions.gypsum_g = Math.round(gramsNeeded * 10) / 10;
    // Reduce remaining calcium need
    delta.calcium = Math.max(0, delta.calcium - (gramsNeeded * SALT_CONTRIBUTIONS.gypsum.calcium) / volumeGal);
  }

  // Add calcium chloride for chloride (also adds calcium)
  if (delta.chloride > 0) {
    const gramsNeeded = (delta.chloride * volumeGal) / SALT_CONTRIBUTIONS.calcium_chloride.chloride;
    additions.calcium_chloride_g = Math.round(gramsNeeded * 10) / 10;
    delta.calcium = Math.max(0, delta.calcium - (gramsNeeded * SALT_CONTRIBUTIONS.calcium_chloride.calcium) / volumeGal);
  }

  // Add epsom salt for remaining magnesium
  if (delta.magnesium > 0) {
    const gramsNeeded = (delta.magnesium * volumeGal) / SALT_CONTRIBUTIONS.epsom_salt.magnesium;
    additions.epsom_salt_g = Math.round(gramsNeeded * 10) / 10;
  }

  // Add baking soda for bicarbonate
  if (delta.bicarbonate > 0) {
    const gramsNeeded = (delta.bicarbonate * volumeGal) / SALT_CONTRIBUTIONS.baking_soda.bicarbonate;
    additions.baking_soda_g = Math.round(gramsNeeded * 10) / 10;
  }

  // Add table salt for remaining sodium (if needed, uncommon)
  if (delta.sodium > 50) {
    // Only if significant sodium needed
    const gramsNeeded = (delta.sodium * volumeGal) / SALT_CONTRIBUTIONS.table_salt.sodium;
    additions.table_salt_g = Math.round(gramsNeeded * 10) / 10;
  }

  return additions;
}

/**
 * Calculate residual alkalinity (RA)
 */
export function calculateResidualAlkalinity(profile: WaterProfile): number {
  // RA = Alkalinity - (Calcium / 1.4) - (Magnesium / 1.7)
  // Alkalinity ≈ Bicarbonate / 1.22 (as CaCO3)
  const alkalinity = profile.bicarbonate_ppm / 1.22;
  return Math.round(alkalinity - profile.calcium_ppm / 1.4 - profile.magnesium_ppm / 1.7);
}

/**
 * Estimate mash pH based on water chemistry and grain bill
 * This is a simplified model based on residual alkalinity
 */
export function estimateMashPH(
  waterProfile: WaterProfile,
  grainBill: GrainBillItem[],
  mashVolumeGal: number
): number {
  // Base mash pH for distilled water with pale malt
  const basePH = 5.8;

  // Calculate weighted average grain color
  const totalWeight = grainBill.reduce((sum, g) => sum + g.weight_lb, 0);
  if (totalWeight === 0) return basePH;

  const weightedColor = grainBill.reduce((sum, g) => sum + g.color_srm * g.weight_lb, 0) / totalWeight;

  // Water-to-grain ratio affects buffering capacity
  // Thinner mashes (higher ratio) are less affected by grain acidity
  const waterToGrainRatio = mashVolumeGal / totalWeight;
  const ratioFactor = Math.min(1.5, Math.max(0.5, 1.25 / waterToGrainRatio));

  // Grain acidity contribution (darker grains lower pH)
  // Approximately -0.01 pH per SRM, modulated by water-to-grain ratio
  const grainContribution = -weightedColor * 0.01 * ratioFactor;

  // Water residual alkalinity contribution
  // Higher RA raises pH, approximately +0.03 pH per 10 ppm RA
  const ra = calculateResidualAlkalinity(waterProfile);
  const waterContribution = (ra / 10) * 0.03;

  // Calculate estimated pH
  const estimatedPH = basePH + grainContribution + waterContribution;

  // Clamp to reasonable range
  return Math.round(Math.max(4.5, Math.min(6.5, estimatedPH)) * 100) / 100;
}

/**
 * Get recommended ion ranges for different beer styles
 */
export function getIonRecommendations(styleCategory: string): {
  calcium: [number, number];
  magnesium: [number, number];
  sodium: [number, number];
  sulfate: [number, number];
  chloride: [number, number];
  bicarbonate: [number, number];
} {
  const lower = styleCategory.toLowerCase();

  // Hoppy styles (IPA, Pale Ale)
  if (lower.includes("ipa") || lower.includes("pale ale") || lower.includes("hoppy")) {
    return {
      calcium: [75, 150],
      magnesium: [5, 20],
      sodium: [0, 50],
      sulfate: [150, 300],
      chloride: [50, 100],
      bicarbonate: [0, 100],
    };
  }

  // Malty styles (Stout, Porter, Brown)
  if (lower.includes("stout") || lower.includes("porter") || lower.includes("malty") || lower.includes("brown")) {
    return {
      calcium: [75, 150],
      magnesium: [5, 20],
      sodium: [0, 75],
      sulfate: [30, 80],
      chloride: [75, 150],
      bicarbonate: [100, 300],
    };
  }

  // Lagers (Pilsner, Helles, Export)
  if (lower.includes("lager") || lower.includes("pilsner") || lower.includes("helles")) {
    return {
      calcium: [25, 75],
      magnesium: [0, 10],
      sodium: [0, 25],
      sulfate: [20, 60],
      chloride: [20, 60],
      bicarbonate: [0, 50],
    };
  }

  // Default balanced
  return {
    calcium: [50, 150],
    magnesium: [5, 20],
    sodium: [0, 50],
    sulfate: [50, 150],
    chloride: [50, 150],
    bicarbonate: [50, 150],
  };
}

// =============================================================================
// Salt-to-Additive Mapping
// =============================================================================

/** Maps SaltAdditions field names to additive catalog names */
export const SALT_ADDITIVE_MAP: Record<keyof SaltAdditions, string> = {
  gypsum_g: "Gypsum",
  calcium_chloride_g: "Calcium Chloride",
  epsom_salt_g: "Epsom Salt",
  baking_soda_g: "Baking Soda",
  chalk_g: "Chalk",
  table_salt_g: "Table Salt",
  magnesium_chloride_g: "Magnesium Chloride",
};

/** Convert SaltAdditions to recipe_additions-compatible items */
export function mapSaltAdditionsToItems(
  additions: SaltAdditions,
  catalog: { id: string; name: string }[]
): { additive_id: string; amount: number; unit: string; timing: string; target: string }[] {
  const items: { additive_id: string; amount: number; unit: string; timing: string; target: string }[] = [];

  for (const [field, additiveName] of Object.entries(SALT_ADDITIVE_MAP)) {
    const grams = additions[field as keyof SaltAdditions];
    if (grams <= 0) continue;

    const catalogEntry = catalog.find(
      (a) => a.name.toLowerCase() === additiveName.toLowerCase()
    );
    if (!catalogEntry) continue;

    items.push({
      additive_id: catalogEntry.id,
      amount: grams,
      unit: "g",
      timing: "mash",
      target: "mash",
    });
  }

  return items;
}
