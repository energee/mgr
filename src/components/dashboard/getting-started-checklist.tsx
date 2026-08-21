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

import { useEffect, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { onboardingKeys } from "@/lib/query-keys";
import { Skeleton } from "@/components/ui/skeleton";
import { DashboardSection } from "./dashboard-section";
import {
  buildChecklistGroups,
  checklistProgress,
  type OnboardingCounts,
} from "./checklist-steps";

/** Remembers across visits whether the checklist rendered last time. */
const VISIBLE_KEY = "mgr-onboarding-checklist-visible";

// The value only changes via our own setItem below, so no store notifications
// are needed — useSyncExternalStore still re-reads per render.
const emptySubscribe = () => () => {};

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

  // Reserve space while loading only for users who saw the checklist last
  // time: established breweries (checklist hidden) keep rendering nothing,
  // while onboarding users get a placeholder instead of the whole dashboard
  // shifting down when the counts resolve (2026-08-21 loading audit).
  // useSyncExternalStore, not a useState initializer: the first client render
  // must match the SSR HTML (server snapshot false — no localStorage there).
  const wasVisible = useSyncExternalStore(
    emptySubscribe,
    () => localStorage.getItem(VISIBLE_KEY) === "1",
    () => false,
  );

  const groups = counts ? buildChecklistGroups(counts) : null;
  const { completed, total } = groups
    ? checklistProgress(groups)
    : { completed: 0, total: 0 };
  // Hidden when all steps are complete
  const visible = groups !== null && completed < total;
  const resolved = groups !== null;

  useEffect(() => {
    if (resolved) localStorage.setItem(VISIBLE_KEY, visible ? "1" : "0");
  }, [resolved, visible]);

  if (isLoading || !counts) {
    if (!wasVisible) return null;
    // Placeholder mirroring the checklist footprint (two step columns + footer)
    return (
      <DashboardSection title="Getting Started">
        <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, col) => (
            <div key={col} className="space-y-3 py-1">
              <Skeleton className="h-3 w-24" />
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-7 w-full" />
              ))}
            </div>
          ))}
        </div>
        <Skeleton className="mt-3 h-3 w-28" />
      </DashboardSection>
    );
  }

  // `!groups` is unreachable here (counts is set) but narrows the type for
  // the map below.
  if (!groups || !visible) return null;

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
