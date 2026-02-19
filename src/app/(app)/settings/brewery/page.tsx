"use client";

/**
 * Brewery Settings Page
 *
 * Configure brewery preferences including measurement units and
 * default water profile (stored in system_settings).
 */

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/form-resolver";
import { z } from "zod";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { entityKeys, settingsKeys } from "@/lib/query-keys";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { useSubmitShortcut } from "@/hooks/use-submit-shortcut";
import { useIsMac } from "@/hooks/use-is-mac";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import {
  useUnitPreferences,
  useUpdateUnitPreferences,
} from "@/hooks/useUnitPreferences";
// =============================================================================
// Schema
// =============================================================================

const unitPreferencesSchema = z.object({
  volume_unit: z.enum(["bbl", "gal", "l", "hl"]),
  weight_unit: z.enum(["lbs", "kg"]),
  temperature_unit: z.enum(["f", "c"]),
  gravity_unit: z.enum(["plato", "sg"]),
  retail_volume_unit: z.enum(["oz", "ml"]),
});

type UnitPreferencesForm = z.infer<typeof unitPreferencesSchema>;

// =============================================================================
// Unit Preference Field Definitions
// =============================================================================

interface UnitField {
  name: keyof UnitPreferencesForm;
  label: string;
  description: string;
  options: { value: string; label: string }[];
}

const UNIT_FIELDS: UnitField[] = [
  {
    name: "volume_unit",
    label: "Production Volume",
    description: "For batch sizes, vessel capacities, and production reports",
    options: [
      { value: "bbl", label: "Barrels (BBL)" },
      { value: "gal", label: "Gallons (gal)" },
      { value: "l", label: "Liters (L)" },
      { value: "hl", label: "Hectoliters (hL)" },
    ],
  },
  {
    name: "weight_unit",
    label: "Ingredient Weight",
    description: "For grain bills, hop additions, and other ingredients",
    options: [
      { value: "lbs", label: "Pounds (lbs)" },
      { value: "kg", label: "Kilograms (kg)" },
    ],
  },
  {
    name: "temperature_unit",
    label: "Temperature",
    description: "For mash temps, fermentation temps, and storage temps",
    options: [
      { value: "f", label: "Fahrenheit (\u00b0F)" },
      { value: "c", label: "Celsius (\u00b0C)" },
    ],
  },
  {
    name: "gravity_unit",
    label: "Gravity",
    description: "For OG, FG, and refractometer readings",
    options: [
      { value: "plato", label: "Plato (\u00b0P)" },
      { value: "sg", label: "Specific Gravity (SG)" },
    ],
  },
  {
    name: "retail_volume_unit",
    label: "Retail Volume",
    description: "For package sizes (cans, bottles, etc.)",
    options: [
      { value: "oz", label: "Fluid Ounces (oz)" },
      { value: "ml", label: "Milliliters (mL)" },
    ],
  },
];

// =============================================================================
// Component
// =============================================================================

export default function BrewerySettingsPage() {
  const { data: preferences, isLoading } = useUnitPreferences();
  const updatePreferences = useUpdateUnitPreferences();
  const isMac = useIsMac();
  const submitRef = useSubmitShortcut();

  const form = useForm<UnitPreferencesForm>({
    resolver: zodResolver(unitPreferencesSchema),
    defaultValues: {
      volume_unit: "bbl",
      weight_unit: "lbs",
      temperature_unit: "f",
      gravity_unit: "plato",
      retail_volume_unit: "oz",
    },
  });

  // Update form when preferences load
  useEffect(() => {
    if (preferences) {
      form.reset({
        volume_unit: preferences.volume_unit,
        weight_unit: preferences.weight_unit,
        temperature_unit: preferences.temperature_unit,
        gravity_unit: preferences.gravity_unit,
        retail_volume_unit: preferences.retail_volume_unit,
      });
    }
  }, [preferences, form]);

  const onSubmit = async (values: UnitPreferencesForm) => {
    try {
      await updatePreferences.mutateAsync(values);
      toast.success("Unit preferences saved");
    } catch (error) {
      console.error("Failed to save preferences:", error);
      toast.error("Failed to save preferences");
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Brewery Settings</h1>
        <p className="text-muted-foreground">
          Configure your brewery preferences
        </p>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Loading preferences...
          </CardContent>
        </Card>
      ) : (
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Unit Preferences */}
          <Card>
            <CardHeader>
              <CardTitle>Measurement Units</CardTitle>
              <CardDescription>
                Set your preferred units for displaying measurements throughout the app.
                All data is stored in canonical units (BBL, lbs, °F, °P) and converted for display.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {UNIT_FIELDS.map((field) => (
                <div key={field.name} className="grid gap-2">
                  <Label htmlFor={field.name}>{field.label}</Label>
                  <Select
                    // eslint-disable-next-line react-hooks/incompatible-library -- React Hook Form watch() incompatible with React Compiler
                    value={form.watch(field.name)}
                    onValueChange={(value) =>
                      form.setValue(field.name, value as UnitPreferencesForm[typeof field.name])
                    }
                  >
                    <SelectTrigger id={field.name} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {field.options.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {field.description}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Submit */}
          <div className="flex justify-end">
            <Button ref={submitRef} type="submit" disabled={updatePreferences.isPending}>
              {updatePreferences.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Preferences
              <KbdGroup>
                <Kbd>{isMac ? "\u2318" : "Ctrl"}</Kbd>
                <Kbd>{isMac ? "\u21B5" : "Enter"}</Kbd>
              </KbdGroup>
            </Button>
          </div>
        </form>
      )}

      <DefaultWaterProfileCard />
    </div>
  );
}

// =============================================================================
// Default Water Profile Card
// =============================================================================

/** Manages the default_water_profile_id system setting */
function DefaultWaterProfileCard() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  // Fetch current default from system_settings
  const { data: currentDefault, isLoading: settingLoading } = useQuery({
    queryKey: settingsKeys.systemSetting("default_water_profile_id"),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("system_settings")
        .select("value")
        .eq("key", "default_water_profile_id")
        .single();
      if (error) throw error;
      const val = data?.value;
      return typeof val === "string" && val !== "null" ? val : null;
    },
  });

  // Fetch water profiles for dropdown
  const { data: profiles = [], isLoading: profilesLoading } = useQuery({
    queryKey: entityKeys.list("water_profiles", { is_active: true }),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("water_profiles")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Sync server state to local
  const [prevDefault, setPrevDefault] = useState(currentDefault);
  if (currentDefault !== prevDefault) {
    setPrevDefault(currentDefault);
    setSelectedId(currentDefault ?? null);
    setHasChanges(false);
  }

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("system_settings")
        .update({ value: selectedId || "null" })
        .eq("key", "default_water_profile_id");
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: settingsKeys.systemSetting("default_water_profile_id"),
      });
      setHasChanges(false);
      toast.success("Default water profile saved");
    },
    onError: (error) => {
      toast.error("Failed to save: " + error.message);
    },
  });

  const isLoading = settingLoading || profilesLoading;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Default Water Profile</CardTitle>
        <CardDescription>
          Select the default source water profile for new recipes.
          Individual recipes can override this.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : (
          <>
            <div className="grid gap-2">
              <Label htmlFor="default_water_profile">Source Water</Label>
              <Select
                value={selectedId || "_none"}
                onValueChange={(value) => {
                  setSelectedId(value === "_none" ? null : value);
                  setHasChanges(true);
                }}
              >
                <SelectTrigger id="default_water_profile" className="w-full">
                  <SelectValue placeholder="No default" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">No default</SelectItem>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                New recipes will use this water profile by default. Manage profiles
                in Settings &gt; Water Profiles.
              </p>
            </div>
            {hasChanges && (
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending}
                >
                  {saveMutation.isPending && (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  )}
                  Save
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
