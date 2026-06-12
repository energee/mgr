/**
 * Getting Started checklist step definitions.
 *
 * Pure helpers (no client/env imports) that map entity row counts to the
 * production and sales onboarding step groups rendered by
 * GettingStartedChecklist. Kept separate so they are unit-testable without
 * pulling in the Supabase client (same pattern as heatmap-utils.ts).
 */

/** Row counts for each entity the checklist tracks. */
export type OnboardingCounts = {
  locations: number;
  recipes: number;
  batches: number;
  brands: number;
  containers: number;
  sellingFormats: number;
  pricingTiers: number;
  customers: number;
};

export type ChecklistStep = {
  label: string;
  href: string;
  done: boolean;
};

export type ChecklistGroup = {
  title: string;
  steps: ChecklistStep[];
};

/**
 * Build the checklist groups from entity counts.
 * Pure function so the step/href wiring is unit-testable.
 */
export function buildChecklistGroups(counts: OnboardingCounts): ChecklistGroup[] {
  return [
    {
      title: "Production",
      steps: [
        { label: "Add your first location", href: "/settings/locations/new", done: counts.locations > 0 },
        { label: "Create a recipe", href: "/production/recipes/new", done: counts.recipes > 0 },
        { label: "Start your first batch", href: "/production/batches/new", done: counts.batches > 0 },
      ],
    },
    {
      title: "Sales",
      steps: [
        { label: "Create a brand", href: "/settings/brands/new", done: counts.brands > 0 },
        { label: "Add a container", href: "/settings/containers/new", done: counts.containers > 0 },
        { label: "Define a selling format", href: "/settings/selling-formats/new", done: counts.sellingFormats > 0 },
        { label: "Set up a pricing tier", href: "/settings/pricing/tiers/new", done: counts.pricingTiers > 0 },
        { label: "Add a customer", href: "/sales/customers/new", done: counts.customers > 0 },
      ],
    },
  ];
}

/** Flattened completion summary across all groups. */
export function checklistProgress(groups: ChecklistGroup[]): { completed: number; total: number } {
  const steps = groups.flatMap((g) => g.steps);
  return { completed: steps.filter((s) => s.done).length, total: steps.length };
}
