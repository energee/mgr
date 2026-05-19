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

export type UserPreferences = UnitPreferences & {
  id: string;
  user_id: string;
  theme: "light" | "dark" | "system";
  date_format: string;
  created_at: string;
  updated_at: string;
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
 * Get full user preferences including theme and date format.
 */
export function useUserPreferences() {
  const supabase = createClient();

  return useQuery({
    queryKey: userKeys.full(),
    queryFn: async (): Promise<UserPreferences | null> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return null;

      const { data, error } = await supabase
        .from("user_preferences")
        .select("*")
        .eq("user_id", user.id)
        .single();

      if (error) return null;

      return data as UserPreferences;
    },
    staleTime: CACHE_DURATIONS.USER_PREFERENCES,
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

      const { error } = await supabase
        .from("user_preferences")
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", user.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.preferences() });
    },
  });
}

/**
 * Update full user preferences.
 */
export function useUpdateUserPreferences() {
  const queryClient = useQueryClient();
  const supabase = createClient();

  return useMutation({
    mutationFn: async (
      updates: Partial<Omit<UserPreferences, "id" | "user_id" | "created_at">>
    ) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase
        .from("user_preferences")
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", user.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.preferences() });
    },
  });
}

// =============================================================================
// Utility Hooks
// =============================================================================

/**
 * Get a specific unit preference with a fallback.
 */
export function useVolumeUnit(): VolumeUnit {
  const { data } = useUnitPreferences();
  return data?.volume_unit ?? "bbl";
}

export function useWeightUnit(): WeightUnit {
  const { data } = useUnitPreferences();
  return data?.weight_unit ?? "lbs";
}

export function useTemperatureUnit(): TemperatureUnit {
  const { data } = useUnitPreferences();
  return data?.temperature_unit ?? "f";
}

export function useGravityUnit(): GravityUnit {
  const { data } = useUnitPreferences();
  return data?.gravity_unit ?? "plato";
}

export function useRetailVolumeUnit(): RetailVolumeUnit {
  const { data } = useUnitPreferences();
  return data?.retail_volume_unit ?? "oz";
}

/**
 * Composite preferences for `extractBrewMeasurements` and other helpers
 * that highlight a brew day's mash temp / gravity / volume in one go.
 */
export function useBrewMeasurementUnits(): {
  temperature: TemperatureUnit;
  gravity: GravityUnit;
  volume: VolumeUnit;
} {
  return {
    temperature: useTemperatureUnit(),
    gravity: useGravityUnit(),
    volume: useVolumeUnit(),
  };
}
