/**
 * Recipe Analysis Utilities for AI Integration
 *
 * These utilities help AI agents analyze and understand recipes,
 * compare them against style guidelines, and suggest improvements.
 */

import { createClient } from "@/lib/supabase/client";

// Create client once at module level (createClient returns singleton)
const supabase = createClient();

// Types
export interface StyleComplianceResult {
  recipe_id: string;
  recipe_name: string;
  style_name: string;
  style_category: string;
  analysis: {
    og: ParameterAnalysis;
    fg: ParameterAnalysis;
    abv: ParameterAnalysis;
    ibu: ParameterAnalysis;
    srm: ParameterAnalysis;
  };
  overall_compliance: boolean;
}

export interface ParameterAnalysis {
  value: number | null;
  min: number;
  max: number;
  status: "in_range" | "below_range" | "above_range" | "unknown";
}

export interface RecipeSummary {
  recipe: {
    id: string;
    name: string;
    volume_bbl: number;
    batch_size_bbl: number;
    boil_time_min: number;
    mash_temp_f: number;
    mash_efficiency: number;
    target_attenuation: number;
    fermentation_days: number;
    conditioning_days: number;
  };
  estimates: {
    og: number | null;
    fg: number | null;
    abv: number | null;
    ibu: number | null;
    srm: number | null;
    cogs: number | null;
  };
  style: {
    id: string;
    name: string;
    category: string;
    og_range: [number, number];
    fg_range: [number, number];
    abv_range: [number, number];
    ibu_range: [number, number];
    srm_range: [number, number];
  } | null;
  yeast: {
    id: string;
    name: string;
    type: string;
    attenuation_min: number;
    attenuation_max: number;
    temp_min_f: number;
    temp_max_f: number;
    flocculation: string;
  } | null;
  water_profile: {
    id: string;
    name: string;
    calcium_ppm: number;
    magnesium_ppm: number;
    sodium_ppm: number;
    sulfate_ppm: number;
    chloride_ppm: number;
    bicarbonate_ppm: number;
    sulfate_chloride_ratio: number;
  } | null;
  grain_bill: Array<{
    malt_name: string;
    malt_type: string;
    weight_lbs: number;
    color_lov: number;
    ppg: number;
    percentage: number;
  }>;
  hop_schedule: Array<{
    hop_name: string;
    hop_type: string;
    weight_oz: number;
    alpha_acid: number;
    timing: string;
    boil_time_min: number | null;
  }>;
  mash_schedule: Array<{
    step_type: string;
    temperature_f: number;
    duration_min: number;
    water_ratio?: number;
    position: number;
  }> | null;
  fermentation_schedule: Array<{
    stage: string;
    temperature_f: number;
    duration_days: number;
    position: number;
  }> | null;
  notes: {
    brew_day: string | null;
    tasting: string | null;
    development: string | null;
  };
}

export interface RecipeSuggestion {
  category: string;
  severity: "info" | "warning" | "error";
  message: string;
  parameter: string;
}

export interface RecipeSuggestionsResult {
  recipe_id: string;
  recipe_name: string;
  suggestion_count: number;
  suggestions: RecipeSuggestion[];
}

/**
 * Analyze a recipe's compliance with its target style guidelines
 */
export async function analyzeStyleCompliance(
  recipeId: string
): Promise<StyleComplianceResult> {

  const { data, error } = await supabase.rpc("analyze_recipe_style_compliance", {
    p_recipe_id: recipeId,
  });

  if (error) {
    throw new Error(`Failed to analyze recipe: ${error.message}`);
  }

  return data as unknown as StyleComplianceResult;
}

/**
 * Get a comprehensive summary of a recipe for AI analysis
 */
export async function getRecipeSummary(recipeId: string): Promise<RecipeSummary> {

  const { data, error } = await supabase.rpc("get_recipe_summary", {
    p_recipe_id: recipeId,
  });

  if (error) {
    throw new Error(`Failed to get recipe summary: ${error.message}`);
  }

  return data as unknown as RecipeSummary;
}

/**
 * Get AI-generated suggestions for improving a recipe
 */
export async function getRecipeSuggestions(
  recipeId: string
): Promise<RecipeSuggestionsResult> {

  const { data, error } = await supabase.rpc("suggest_recipe_improvements", {
    p_recipe_id: recipeId,
  });

  if (error) {
    throw new Error(`Failed to get suggestions: ${error.message}`);
  }

  return data as unknown as RecipeSuggestionsResult;
}

/**
 * Calculate brewing metrics from recipe parameters
 */
export const BrewingCalculations = {
  /**
   * Calculate Original Gravity from grain bill
   */
  calculateOG(
    grains: Array<{ weight_lbs: number; ppg: number }>,
    volumeGal: number,
    efficiency: number
  ): number {
    const totalPoints = grains.reduce(
      (sum, grain) => sum + grain.weight_lbs * grain.ppg,
      0
    );
    const points = (totalPoints * (efficiency / 100)) / volumeGal;
    return 1 + points / 1000;
  },

  /**
   * Calculate Final Gravity from OG and attenuation
   */
  calculateFG(og: number, attenuationPercent: number): number {
    return 1 + (og - 1) * (1 - attenuationPercent / 100);
  },

  /**
   * Calculate ABV from OG and FG
   */
  calculateABV(og: number, fg: number): number {
    return (og - fg) * 131.25;
  },

  /**
   * Calculate IBU using Tinseth formula
   */
  calculateIBU(
    hops: Array<{
      weight_oz: number;
      alpha_acid: number;
      boil_time_min: number;
    }>,
    og: number,
    volumeGal: number
  ): number {
    return hops.reduce((totalIBU, hop) => {
      // Bigness factor
      const bignessFactor = 1.65 * Math.pow(0.000125, og - 1);
      // Boil time factor
      const boilTimeFactor = (1 - Math.exp(-0.04 * hop.boil_time_min)) / 4.15;
      // Utilization
      const utilization = bignessFactor * boilTimeFactor;
      // IBU contribution
      const ibu =
        (hop.weight_oz * hop.alpha_acid * utilization * 74.89) / volumeGal;
      return totalIBU + ibu;
    }, 0);
  },

  /**
   * Calculate SRM using Morey equation
   */
  calculateSRM(
    grains: Array<{ weight_lbs: number; color_lov: number }>,
    volumeGal: number
  ): number {
    const mcu = grains.reduce(
      (sum, grain) => sum + (grain.weight_lbs * grain.color_lov) / volumeGal,
      0
    );
    return 1.4922 * Math.pow(mcu, 0.6859);
  },

  /**
   * Convert between gravity units
   */
  sgToPlato(sg: number): number {
    return (-1 * 616.868 + 1111.14 * sg - 630.272 * sg * sg + 135.997 * sg * sg * sg);
  },

  platoToSG(plato: number): number {
    return 1 + plato / (258.6 - (plato / 258.2) * 227.1);
  },
};

// Water profile data by style character
type WaterProfile = { sulfate: [number, number]; chloride: [number, number]; ratio: string };

const WATER_PROFILES: Record<string, WaterProfile> = {
  hoppy: { sulfate: [150, 300], chloride: [50, 100], ratio: "2:1 to 3:1" },
  malty: { sulfate: [50, 100], chloride: [100, 200], ratio: "1:2" },
  balanced: { sulfate: [30, 80], chloride: [30, 80], ratio: "1:1" },
  default: { sulfate: [75, 150], chloride: [75, 150], ratio: "1:1" },
};

const STYLE_KEYWORDS: Record<keyof typeof WATER_PROFILES, string[]> = {
  hoppy: ["ipa", "pale ale", "hoppy"],
  malty: ["stout", "porter", "malty"],
  balanced: ["pilsner", "lager", "kolsch"],
  default: [],
};

/**
 * Water chemistry analysis helpers
 */
export const WaterChemistry = {
  /**
   * Calculate sulfate to chloride ratio
   */
  sulfateChlorideRatio(sulfate: number, chloride: number): number {
    if (chloride === 0) return Infinity;
    return sulfate / chloride;
  },

  /**
   * Get recommended profile for a style category
   */
  getRecommendedProfile(styleCategory: string): WaterProfile {
    const lower = styleCategory.toLowerCase();
    for (const [profileKey, keywords] of Object.entries(STYLE_KEYWORDS)) {
      if (keywords.some((kw) => lower.includes(kw))) {
        return WATER_PROFILES[profileKey];
      }
    }
    return WATER_PROFILES.default;
  },

  /**
   * Analyze water profile for a given style
   */
  analyzeForStyle(
    profile: { sulfate_ppm: number; chloride_ppm: number },
    styleCategory: string
  ): { suitable: boolean; recommendation: string } {
    const recommended = this.getRecommendedProfile(styleCategory);
    const ratio = this.sulfateChlorideRatio(profile.sulfate_ppm, profile.chloride_ppm);

    const sulfateInRange =
      profile.sulfate_ppm >= recommended.sulfate[0] &&
      profile.sulfate_ppm <= recommended.sulfate[1];
    const chlorideInRange =
      profile.chloride_ppm >= recommended.chloride[0] &&
      profile.chloride_ppm <= recommended.chloride[1];

    if (sulfateInRange && chlorideInRange) {
      return {
        suitable: true,
        recommendation: `Water profile is well-suited for ${styleCategory} (${recommended.ratio} ratio)`,
      };
    }

    const suggestions: string[] = [];
    if (!sulfateInRange) {
      suggestions.push(
        profile.sulfate_ppm < recommended.sulfate[0]
          ? "increase sulfate"
          : "decrease sulfate"
      );
    }
    if (!chlorideInRange) {
      suggestions.push(
        profile.chloride_ppm < recommended.chloride[0]
          ? "increase chloride"
          : "decrease chloride"
      );
    }

    return {
      suitable: false,
      recommendation: `Consider adjusting water: ${suggestions.join(", ")} for optimal ${styleCategory} character`,
    };
  },
};

/**
 * Fermentation analysis helpers
 */
export const FermentationAnalysis = {
  /**
   * Check if fermentation temperature is appropriate for yeast
   */
  validateFermentationTemp(
    tempF: number,
    yeast: { temp_min_f: number; temp_max_f: number }
  ): { valid: boolean; message: string } {
    if (tempF < yeast.temp_min_f) {
      return {
        valid: false,
        message: `Temperature ${tempF}F is below yeast minimum (${yeast.temp_min_f}F). Risk of slow/stuck fermentation.`,
      };
    }
    if (tempF > yeast.temp_max_f) {
      return {
        valid: false,
        message: `Temperature ${tempF}F is above yeast maximum (${yeast.temp_max_f}F). Risk of off-flavors.`,
      };
    }
    return { valid: true, message: "Fermentation temperature is within yeast range" };
  },

  /**
   * Estimate fermentation timeline
   */
  estimateTimeline(
    og: number,
    yeastType: string
  ): { primary_days: number; conditioning_days: number; total_days: number } {
    // Higher gravity = longer fermentation
    const gravityFactor = og > 1.07 ? 1.5 : og > 1.05 ? 1.2 : 1;

    // Lagers need more time
    const typeFactor = yeastType.toLowerCase().includes("lager") ? 2 : 1;

    const primaryDays = Math.round(7 * gravityFactor * typeFactor);
    const conditioningDays = Math.round(7 * typeFactor);

    return {
      primary_days: primaryDays,
      conditioning_days: conditioningDays,
      total_days: primaryDays + conditioningDays,
    };
  },
};
