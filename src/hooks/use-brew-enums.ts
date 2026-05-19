/**
 * useBrewEnums - Fetches brew phases and metrics from enum_values
 *
 * Provides phase options (grouped for the form selector) and metric options
 * (with unitType/decimals metadata for UnitInput rendering) from the
 * centralized enum registry instead of hardcoded configs.
 */

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { unwrap } from "@/lib/supabase/query-helpers";
import { settingsKeys } from "@/lib/query-keys";
import { ENUM_TYPES } from "@/lib/enums";
import type { Json } from "@/types/supabase";
import type { UnitType } from "@/domain/units";

// =============================================================================
// Types
// =============================================================================

export type BrewPhase = {
  value: string;
  label: string;
  icon: string | null;
  group: string | null;
}

export type BrewMetric = {
  value: string;
  label: string;
  unit: string;
  unitType?: UnitType;
  decimals?: number;
}

export type BrewPhaseGroup = {
  group: string;
  phases: BrewPhase[];
}

// =============================================================================
// Hook
// =============================================================================

export function useBrewPhases() {
  return useQuery({
    queryKey: settingsKeys.enumValues(ENUM_TYPES.BREW_PHASE),
    queryFn: async () => {
      const supabase = createClient();
      const data = await unwrap(
        supabase
          .from("enum_values")
          .select("value, label, icon, group_name, sort_order")
          .eq("enum_type", ENUM_TYPES.BREW_PHASE)
          .eq("is_active", true)
          .order("sort_order")
      );

      const phases: BrewPhase[] = (data ?? []).map((d) => ({
        value: d.value,
        label: d.label,
        icon: d.icon,
        group: d.group_name,
      }));

      // Group phases by group_name for the form selector
      const groupMap = new Map<string, BrewPhase[]>();
      for (const phase of phases) {
        const group = phase.group ?? "other";
        if (!groupMap.has(group)) groupMap.set(group, []);
        groupMap.get(group)!.push(phase);
      }

      const groups: BrewPhaseGroup[] = [];
      for (const [group, items] of groupMap) {
        groups.push({ group, phases: items });
      }

      // Build a label lookup for display
      const labelMap = new Map<string, string>();
      for (const phase of phases) {
        labelMap.set(phase.value, phase.label);
      }

      return { phases, groups, labelMap };
    },
    staleTime: 5 * 60 * 1000, // Enum values rarely change
  });
}

export function useBrewMetrics() {
  return useQuery({
    queryKey: settingsKeys.enumValues(ENUM_TYPES.BREW_METRIC),
    queryFn: async () => {
      const supabase = createClient();
      const data = await unwrap(
        supabase
          .from("enum_values")
          .select("value, label, description, sort_order, metadata")
          .eq("enum_type", ENUM_TYPES.BREW_METRIC)
          .eq("is_active", true)
          .order("sort_order")
      );

      const metrics: BrewMetric[] = (data ?? []).map((d) => {
        const meta = d.metadata as Record<string, Json> | null;
        return {
          value: d.value,
          label: d.label,
          unit: d.description ?? "",
          unitType: (meta?.unitType as UnitType) ?? undefined,
          decimals: typeof meta?.decimals === "number" ? meta.decimals : undefined,
        };
      });

      // Build a config lookup for UnitInput rendering
      const configMap = new Map<string, BrewMetric>();
      for (const metric of metrics) {
        configMap.set(metric.value, metric);
      }

      return { metrics, configMap };
    },
    staleTime: 5 * 60 * 1000,
  });
}
