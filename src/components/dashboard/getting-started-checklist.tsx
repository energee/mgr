"use client";

/**
 * Getting Started Checklist
 *
 * Onboarding checklist shown on the production dashboard when the brewery
 * has minimal data. Covers two tracks:
 * - Production: location, recipe, first batch
 * - Sales: brand, container, selling format, pricing tier, customer
 *   (the prerequisites for creating sellable inventory and orders, which
 *   are otherwise scattered across the settings pages)
 *
 * Hides itself once every step is complete. Counts are fetched with
 * lightweight `head: true` count queries under onboardingKeys.counts().
 * Step definitions live in checklist-steps.ts (pure, unit-tested).
 */

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { onboardingKeys } from "@/lib/query-keys";
import { DashboardSection } from "./dashboard-section";
import {
  buildChecklistGroups,
  checklistProgress,
  type OnboardingCounts,
} from "./checklist-steps";

/** Onboarding checklist shown when the brewery has minimal data. Hides once all steps are complete. */
export function GettingStartedChecklist() {
  const supabase = createClient();

  const { data: counts, isLoading } = useQuery({
    queryKey: onboardingKeys.counts(),
    queryFn: async (): Promise<OnboardingCounts> => {
      const [locations, recipes, batches, brands, containers, sellingFormats, pricingTiers, customers] =
        await Promise.all([
          supabase.from("locations").select("*", { count: "exact", head: true }),
          supabase.from("recipes").select("*", { count: "exact", head: true }),
          supabase.from("batches").select("*", { count: "exact", head: true }),
          supabase.from("brands").select("*", { count: "exact", head: true }),
          supabase.from("containers").select("*", { count: "exact", head: true }),
          supabase.from("selling_formats").select("*", { count: "exact", head: true }),
          supabase.from("pricing_tiers").select("*", { count: "exact", head: true }),
          supabase.from("customers").select("*", { count: "exact", head: true }),
        ]);
      return {
        locations: locations.count ?? 0,
        recipes: recipes.count ?? 0,
        batches: batches.count ?? 0,
        brands: brands.count ?? 0,
        containers: containers.count ?? 0,
        sellingFormats: sellingFormats.count ?? 0,
        pricingTiers: pricingTiers.count ?? 0,
        customers: customers.count ?? 0,
      };
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading || !counts) return null;

  const groups = buildChecklistGroups(counts);
  const { completed, total } = checklistProgress(groups);

  // Hide when all steps are complete
  if (completed === total) return null;

  return (
    <DashboardSection title="Getting Started">
      <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        {groups.map((group) => (
          <div key={group.title}>
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
              {group.title}
            </h3>
            <div className="divide-y">
              {group.steps.map((step) => (
                <Link
                  key={step.href}
                  href={step.href}
                  className="flex items-center gap-3 py-2"
                >
                  {step.done ? (
                    <CheckCircle2 className="size-5 text-emerald-500 shrink-0" />
                  ) : (
                    <Circle className="size-5 text-muted-foreground/40 shrink-0" />
                  )}
                  <span
                    className={`text-sm ${step.done ? "line-through text-muted-foreground" : ""}`}
                  >
                    {step.label}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground mt-3">
        {completed} of {total} complete
      </p>
    </DashboardSection>
  );
}
