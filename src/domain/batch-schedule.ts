/**
 * Batch Schedule Domain
 *
 * Shared derivations for a batch's recipe-driven production schedule:
 * planned_start_date + fermentation_days (+ conditioning_days), with the
 * standard 14/7-day fallbacks when the recipe doesn't specify durations.
 *
 * Used by the production timeline, the dashboard Today panel, the AI chat
 * vessel-utilization tool, and the create-batch-from-shortfall dialog so the
 * projected phase-end / ready-date math stays consistent everywhere.
 */

import { addDays, format, parseISO } from "date-fns";

/** Fallback fermentation duration when the recipe doesn't specify one. */
const DEFAULT_FERMENTATION_DAYS = 14;

/** Fallback conditioning duration when the recipe doesn't specify one. */
const DEFAULT_CONDITIONING_DAYS = 7;

/** The recipe fields that drive schedule math (snake_case to match DB rows). */
type RecipeScheduleDays = {
  fermentation_days?: number | null;
  conditioning_days?: number | null;
};

/**
 * Resolve a recipe's fermentation/conditioning durations, applying the
 * standard 14/7-day fallbacks for missing (or zero) values.
 */
export function scheduleDays(recipe: RecipeScheduleDays | null | undefined): {
  fermentationDays: number;
  conditioningDays: number;
} {
  return {
    fermentationDays: recipe?.fermentation_days || DEFAULT_FERMENTATION_DAYS,
    conditioningDays: recipe?.conditioning_days || DEFAULT_CONDITIONING_DAYS,
  };
}

/**
 * Days from planned start until the given phase's scheduled end:
 * fermenting -> fermentation_days; conditioning (or later) ->
 * fermentation_days + conditioning_days.
 */
export function phaseEndDays(
  recipe: RecipeScheduleDays | null | undefined,
  status: string | null | undefined,
): number {
  const { fermentationDays, conditioningDays } = scheduleDays(recipe);
  return status === "fermenting"
    ? fermentationDays
    : fermentationDays + conditioningDays;
}

/**
 * Projected date the batch is ready (and its vessel frees up):
 * planned start + fermentation + conditioning, as "yyyy-MM-dd".
 * Returns null when the batch has no planned start date.
 */
export function projectedReadyDate(
  plannedStartDate: string | null | undefined,
  recipe: RecipeScheduleDays | null | undefined,
): string | null {
  if (!plannedStartDate) return null;
  const { fermentationDays, conditioningDays } = scheduleDays(recipe);
  return format(
    addDays(parseISO(plannedStartDate), fermentationDays + conditioningDays),
    "yyyy-MM-dd",
  );
}
