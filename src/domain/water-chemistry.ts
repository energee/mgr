/**
 * Water Chemistry Library
 *
 * Provides calculations for brewing water chemistry:
 * - Salt additions to reach target water profiles
 * - Ion contributions from common brewing salts
 * - Residual alkalinity and mash pH estimation
 */

// --- Types ---

export type WaterProfile = {
  calcium_ppm: number;
  magnesium_ppm: number;
  sodium_ppm: number;
  sulfate_ppm: number;
  chloride_ppm: number;
  bicarbonate_ppm: number;
}

export type SaltAdditions = {
  gypsum_g: number; // CaSO4
  calcium_chloride_g: number; // CaCl2
  epsom_salt_g: number; // MgSO4
  baking_soda_g: number; // NaHCO3
  chalk_g: number; // CaCO3
  table_salt_g: number; // NaCl
  magnesium_chloride_g: number; // MgCl2
}

// --- Helpers ---

/** Round to one decimal place */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** The six ion fields on WaterProfile */
const ION_FIELDS: (keyof WaterProfile)[] = [
  "calcium_ppm",
  "magnesium_ppm",
  "sodium_ppm",
  "sulfate_ppm",
  "chloride_ppm",
  "bicarbonate_ppm",
];

// --- Salt Ion Contributions (ppm per gram per gallon) ---

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

/** Mapping from salt contribution property names to WaterProfile field names */
const ION_PROPERTY_TO_FIELD: Record<string, keyof WaterProfile> = {
  calcium: "calcium_ppm",
  magnesium: "magnesium_ppm",
  sodium: "sodium_ppm",
  sulfate: "sulfate_ppm",
  chloride: "chloride_ppm",
  bicarbonate: "bicarbonate_ppm",
};

// --- Calculation Functions ---

/** Calculate sulfate to chloride ratio */
export function calculateSulfateChlorideRatio(sulfate: number, chloride: number): number {
  if (chloride === 0) return Infinity;
  return round1(sulfate / chloride);
}

/** Format sulfate:chloride ratio as "N:1" */
export function formatRatio(ratio: number): string {
  if (ratio === Infinity) return "\u221E:1";
  return `${ratio}:1`;
}

/** Get ratio description based on sulfate:chloride ratio */
export function getRatioDescription(ratio: number): { label: string; character: string } {
  if (ratio >= 2.5) return { label: "Very Hoppy", character: "Accentuates hop bitterness and dryness" };
  if (ratio >= 1.5) return { label: "Hoppy", character: "Enhances hop character" };
  if (ratio >= 0.8) return { label: "Balanced", character: "Neither malt nor hop emphasis" };
  if (ratio >= 0.4) return { label: "Malty", character: "Enhances malt sweetness" };
  return { label: "Very Malty", character: "Strong malt emphasis" };
}

/** Calculate ion contribution from a salt addition */
export function calculateIonContribution(
  salt: keyof typeof SALT_CONTRIBUTIONS,
  grams: number,
  volumeGal: number
): Partial<WaterProfile> {
  const contributions = SALT_CONTRIBUTIONS[salt];
  const result: Partial<WaterProfile> = {};
  const factor = grams / volumeGal;

  for (const [prop, field] of Object.entries(ION_PROPERTY_TO_FIELD)) {
    if (prop in contributions) {
      result[field] = (contributions as unknown as Record<string, number>)[prop] * factor;
    }
  }

  // Chalk contributes carbonate, which converts to bicarbonate at a 1.22 ratio
  if ("carbonate" in contributions) {
    result.bicarbonate_ppm = contributions.carbonate * factor * 1.22;
  }

  return result;
}

/** Calculate the resulting water profile after salt additions */
export function calculateResultingProfile(
  source: WaterProfile,
  additions: SaltAdditions,
  volumeGal: number
): WaterProfile {
  const result = { ...source };

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

  // Round all ion values to one decimal place
  const rounded = {} as WaterProfile;
  for (const field of ION_FIELDS) {
    rounded[field] = round1(result[field]);
  }
  return rounded;
}

/**
 * Simple calculation of suggested additions to reach target profile.
 * Uses a greedy algorithm: match sulfate first (gypsum), then chloride (CaCl2),
 * then remaining magnesium, bicarbonate, and sodium.
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

  const delta = {
    calcium: Math.max(0, target.calcium_ppm - source.calcium_ppm),
    magnesium: Math.max(0, target.magnesium_ppm - source.magnesium_ppm),
    sodium: Math.max(0, target.sodium_ppm - source.sodium_ppm),
    sulfate: Math.max(0, target.sulfate_ppm - source.sulfate_ppm),
    chloride: Math.max(0, target.chloride_ppm - source.chloride_ppm),
    bicarbonate: Math.max(0, target.bicarbonate_ppm - source.bicarbonate_ppm),
  };

  /** Calculate grams of salt needed to hit a target delta ppm */
  function gramsForDelta(deltaPpm: number, contributionPerGramPerGal: number): number {
    return round1((deltaPpm * volumeGal) / contributionPerGramPerGal);
  }

  // Gypsum for sulfate (also contributes calcium)
  if (delta.sulfate > 0) {
    const grams = gramsForDelta(delta.sulfate, SALT_CONTRIBUTIONS.gypsum.sulfate);
    additions.gypsum_g = grams;
    delta.calcium = Math.max(0, delta.calcium - (grams * SALT_CONTRIBUTIONS.gypsum.calcium) / volumeGal);
  }

  // Calcium chloride for chloride (also contributes calcium)
  if (delta.chloride > 0) {
    const grams = gramsForDelta(delta.chloride, SALT_CONTRIBUTIONS.calcium_chloride.chloride);
    additions.calcium_chloride_g = grams;
    delta.calcium = Math.max(0, delta.calcium - (grams * SALT_CONTRIBUTIONS.calcium_chloride.calcium) / volumeGal);
  }

  // Epsom salt for remaining magnesium
  if (delta.magnesium > 0) {
    additions.epsom_salt_g = gramsForDelta(delta.magnesium, SALT_CONTRIBUTIONS.epsom_salt.magnesium);
  }

  // Baking soda for bicarbonate
  if (delta.bicarbonate > 0) {
    additions.baking_soda_g = gramsForDelta(delta.bicarbonate, SALT_CONTRIBUTIONS.baking_soda.bicarbonate);
  }

  // Table salt for sodium (only if significant sodium needed)
  if (delta.sodium > 50) {
    additions.table_salt_g = gramsForDelta(delta.sodium, SALT_CONTRIBUTIONS.table_salt.sodium);
  }

  return additions;
}


// --- Shared Ion Metadata ---

/** Ion field keys and their display labels, used by chemistry summary tables */
export const WATER_IONS = [
  { key: "calcium_ppm", label: "Ca\u00B2\u207A" },
  { key: "magnesium_ppm", label: "Mg\u00B2\u207A" },
  { key: "sodium_ppm", label: "Na\u207A" },
  { key: "sulfate_ppm", label: "SO\u2084\u00B2\u207B" },
  { key: "chloride_ppm", label: "Cl\u207B" },
  { key: "bicarbonate_ppm", label: "HCO\u2083\u207B" },
] as const;

// --- Nullable-to-WaterProfile Conversion ---

/** Database rows return nullable ppm values; this normalizes them to a WaterProfile */
export function toWaterProfile(row: {
  calcium_ppm?: number | null;
  magnesium_ppm?: number | null;
  sodium_ppm?: number | null;
  sulfate_ppm?: number | null;
  chloride_ppm?: number | null;
  bicarbonate_ppm?: number | null;
}): WaterProfile {
  return {
    calcium_ppm: row.calcium_ppm ?? 0,
    magnesium_ppm: row.magnesium_ppm ?? 0,
    sodium_ppm: row.sodium_ppm ?? 0,
    sulfate_ppm: row.sulfate_ppm ?? 0,
    chloride_ppm: row.chloride_ppm ?? 0,
    bicarbonate_ppm: row.bicarbonate_ppm ?? 0,
  };
}

// --- Salt-to-Additive Mapping ---

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

export type SaltAdditionItem = {
  additive_id: string;
  amount: number;
  unit: string;
  timing: string;
  target: string;
}

/** Convert SaltAdditions to recipe_additions-compatible items */
export function mapSaltAdditionsToItems(
  additions: SaltAdditions,
  catalog: { id: string; name: string }[]
): SaltAdditionItem[] {
  const items: SaltAdditionItem[] = [];

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
