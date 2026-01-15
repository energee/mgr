"use client";

/**
 * Brewery Settings Page
 *
 * Configure brewery preferences including measurement units.
 * Unit preferences are stored per-user in the user_preferences table.
 */

import { useEffect } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
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
import { ArrowLeft, Building2, Ruler, Save } from "lucide-react";
import {
  useUnitPreferences,
  useUpdateUnitPreferences,
  type UnitPreferences,
} from "@/hooks/useUnitPreferences";
import { getUnitLabel } from "@/lib/units";

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
// Unit Options
// =============================================================================

const VOLUME_OPTIONS = [
  { value: "bbl", label: "Barrels (BBL)" },
  { value: "gal", label: "Gallons (gal)" },
  { value: "l", label: "Liters (L)" },
  { value: "hl", label: "Hectoliters (hL)" },
];

const WEIGHT_OPTIONS = [
  { value: "lbs", label: "Pounds (lbs)" },
  { value: "kg", label: "Kilograms (kg)" },
];

const TEMPERATURE_OPTIONS = [
  { value: "f", label: "Fahrenheit (°F)" },
  { value: "c", label: "Celsius (°C)" },
];

const GRAVITY_OPTIONS = [
  { value: "plato", label: "Plato (°P)" },
  { value: "sg", label: "Specific Gravity (SG)" },
];

const RETAIL_VOLUME_OPTIONS = [
  { value: "oz", label: "Fluid Ounces (oz)" },
  { value: "ml", label: "Milliliters (mL)" },
];

// =============================================================================
// Component
// =============================================================================

export default function BrewerySettingsPage() {
  const { data: preferences, isLoading } = useUnitPreferences();
  const updatePreferences = useUpdateUnitPreferences();

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
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/settings">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Building2 className="h-6 w-6" />
            Brewery Settings
          </h1>
          <p className="text-muted-foreground">
            Configure your brewery preferences
          </p>
        </div>
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
              <CardTitle className="flex items-center gap-2">
                <Ruler className="h-5 w-5" />
                Measurement Units
              </CardTitle>
              <CardDescription>
                Set your preferred units for displaying measurements throughout the app.
                All data is stored in canonical units (BBL, lbs, °F, °P) and converted for display.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Volume */}
              <div className="grid gap-2">
                <Label htmlFor="volume_unit">Production Volume</Label>
                <Select
                  value={form.watch("volume_unit")}
                  onValueChange={(value) =>
                    form.setValue("volume_unit", value as UnitPreferencesForm["volume_unit"])
                  }
                >
                  <SelectTrigger id="volume_unit" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VOLUME_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  For batch sizes, vessel capacities, and production reports
                </p>
              </div>

              {/* Weight */}
              <div className="grid gap-2">
                <Label htmlFor="weight_unit">Ingredient Weight</Label>
                <Select
                  value={form.watch("weight_unit")}
                  onValueChange={(value) =>
                    form.setValue("weight_unit", value as UnitPreferencesForm["weight_unit"])
                  }
                >
                  <SelectTrigger id="weight_unit" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEIGHT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  For grain bills, hop additions, and other ingredients
                </p>
              </div>

              {/* Temperature */}
              <div className="grid gap-2">
                <Label htmlFor="temperature_unit">Temperature</Label>
                <Select
                  value={form.watch("temperature_unit")}
                  onValueChange={(value) =>
                    form.setValue("temperature_unit", value as UnitPreferencesForm["temperature_unit"])
                  }
                >
                  <SelectTrigger id="temperature_unit" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TEMPERATURE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  For mash temps, fermentation temps, and storage temps
                </p>
              </div>

              {/* Gravity */}
              <div className="grid gap-2">
                <Label htmlFor="gravity_unit">Gravity</Label>
                <Select
                  value={form.watch("gravity_unit")}
                  onValueChange={(value) =>
                    form.setValue("gravity_unit", value as UnitPreferencesForm["gravity_unit"])
                  }
                >
                  <SelectTrigger id="gravity_unit" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GRAVITY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  For OG, FG, and refractometer readings
                </p>
              </div>

              {/* Retail Volume */}
              <div className="grid gap-2">
                <Label htmlFor="retail_volume_unit">Retail Volume</Label>
                <Select
                  value={form.watch("retail_volume_unit")}
                  onValueChange={(value) =>
                    form.setValue("retail_volume_unit", value as UnitPreferencesForm["retail_volume_unit"])
                  }
                >
                  <SelectTrigger id="retail_volume_unit" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RETAIL_VOLUME_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  For package sizes (cans, bottles, etc.)
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Submit */}
          <div className="flex justify-end">
            <Button type="submit" disabled={updatePreferences.isPending}>
              <Save className="h-4 w-4 mr-2" />
              {updatePreferences.isPending ? "Saving..." : "Save Preferences"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
