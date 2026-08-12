/**
 * User Unit Preferences Hook
 *
 * Provides access to user's unit display preferences with caching.
 * Auto-loads on mount and caches for 5 minutes.
 *
 * @see docs/MGR-SPECIFICATION.md Section 9 - Unit System
 */

"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { unwrap } from "@/lib/supabase/query-helpers";
import { userKeys } from "@/lib/query-keys";
import { CACHE_DURATIONS } from "@/lib/constants";
import type {
  VolumeUnit,
  WeightUnit,
  TemperatureUnit,
  GravityUnit,
  RetailVolumeUnit,
} from "@/domain/units";

// =============================================================================
// Types
// =============================================================================

export type UnitPreferences = {
  volume_unit: VolumeUnit;
  weight_unit: WeightUnit;
  temperature_unit: TemperatureUnit;
  gravity_unit: GravityUnit;
  retail_volume_unit: RetailVolumeUnit;
}

// =============================================================================
// Defaults
// =============================================================================

const DEFAULT_UNIT_PREFERENCES: UnitPreferences = {
  volume_unit: "bbl",
  weight_unit: "lbs",
  temperature_unit: "f",
  gravity_unit: "plato",
  retail_volume_unit: "oz",
};

// =============================================================================
// Hooks
// =============================================================================

/**
 * Get user's unit preferences.
 * Returns defaults if user not authenticated or preferences not found.
 */
export function useUnitPreferences() {
  const supabase = createClient();

  return useQuery({
    queryKey: userKeys.units(),
    queryFn: async (): Promise<UnitPreferences> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        return DEFAULT_UNIT_PREFERENCES;
      }

      const { data, error } = await supabase
        .from("user_preferences")
        .select("volume_unit, weight_unit, temperature_unit, gravity_unit, retail_volume_unit")
        .eq("user_id", user.id)
        .single();

      if (error || !data) {
        return DEFAULT_UNIT_PREFERENCES;
      }

      return {
        volume_unit: data.volume_unit as VolumeUnit,
        weight_unit: data.weight_unit as WeightUnit,
        temperature_unit: data.temperature_unit as TemperatureUnit,
        gravity_unit: data.gravity_unit as GravityUnit,
        retail_volume_unit: data.retail_volume_unit as RetailVolumeUnit,
      };
    },
    staleTime: CACHE_DURATIONS.USER_PREFERENCES, // 5 minutes
    gcTime: 1000 * 60 * 30, // 30 minutes
  });
}

/**
 * Update user's unit preferences.
 */
export function useUpdateUnitPreferences() {
  const queryClient = useQueryClient();
  const supabase = createClient();

  return useMutation({
    mutationFn: async (updates: Partial<UnitPreferences>) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) throw new Error("Not authenticated");

      await unwrap(
        supabase
          .from("user_preferences")
          .update({ ...updates, updated_at: new Date().toISOString() })
          .eq("user_id", user.id)
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.preferences() });
    },
  });
}

/**
 * Unit preferences, falling back to the defaults while loading or when
 * unauthenticated — for components that only need the resolved units (not
 * loading state). Callers destructure the fields they use, e.g.
 * `const { volume_unit } = useResolvedUnitPreferences()`.
 */
export function useResolvedUnitPreferences(): UnitPreferences {
  const { data } = useUnitPreferences();
  return data ?? DEFAULT_UNIT_PREFERENCES;
}
