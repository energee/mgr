"use client";

/**
 * Brewery Settings Page
 *
 * Configure brewery preferences including measurement units.
 * Unit preferences are stored per-user in the user_preferences table.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Input } from "@/components/ui/input";
import { ArrowLeft, Bot, Building2, Check, Ruler, Save } from "lucide-react";
import {
  useUnitPreferences,
  useUpdateUnitPreferences,
} from "@/hooks/useUnitPreferences";
import { userKeys } from "@/lib/query-keys";

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
// API Key Section (separate from unit preferences)
// =============================================================================

function ApiKeySection() {
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const [hasExistingKey, setHasExistingKey] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/settings/api-key?scope=user")
      .then((res) => res.json())
      .then((data) => {
        setHasExistingKey(data.hasKey === true);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const saveKey = useMutation({
    mutationFn: async (key: string) => {
      const res = await fetch("/api/settings/api-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "user", key }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.preferences() });
      setHasExistingKey(!!apiKey);
      setApiKey("");
      toast.success(apiKey ? "API key saved" : "API key removed");
    },
    onError: () => {
      toast.error("Failed to save API key");
    },
  });

  if (!loaded) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-5 w-5" />
          AI Assistant
        </CardTitle>
        <CardDescription>
          Set your personal API key for the AI brewery assistant.
          This overrides the global key set in System Settings.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasExistingKey && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Check className="h-4 w-4 text-green-600" />
            Personal API key is configured
          </div>
        )}
        <div className="grid gap-2">
          <Label htmlFor="anthropic_api_key">
            {hasExistingKey ? "Replace API Key" : "Anthropic API Key"}
          </Label>
          <div className="flex gap-2">
            <Input
              id="anthropic_api_key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-..."
              autoComplete="off"
            />
            <Button
              type="button"
              onClick={() => saveKey.mutate(apiKey)}
              disabled={!apiKey || saveKey.isPending}
            >
              {saveKey.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Optional. Get your key from{" "}
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              console.anthropic.com
            </a>
            . Leave blank to use the brewery&apos;s global key.
          </p>
        </div>
        {hasExistingKey && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => saveKey.mutate("")}
            disabled={saveKey.isPending}
          >
            Remove personal key
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

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
                  // eslint-disable-next-line react-hooks/incompatible-library -- React Hook Form watch() incompatible with React Compiler
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

      {/* API Key — separate from the unit preferences form */}
      <ApiKeySection />
    </div>
  );
}
