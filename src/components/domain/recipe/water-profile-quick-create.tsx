/**
 * Water Profile Quick Create
 *
 * Compact popover for creating a new water profile inline from relation
 * dropdowns (e.g., on the recipe detail page). Avoids navigating away
 * to Settings > Water Profiles.
 */

"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { createClient } from "@/lib/supabase/client";
import { zodResolver } from "@/lib/form-resolver";
import { waterProfileSchema, type WaterProfileFormValues } from "@/lib/schemas/water-profile";
import { entityKeys } from "@/lib/query-keys";

const ION_FIELDS = [
  { name: "calcium_ppm", label: "Ca²⁺" },
  { name: "magnesium_ppm", label: "Mg²⁺" },
  { name: "sodium_ppm", label: "Na⁺" },
  { name: "sulfate_ppm", label: "SO₄²⁻" },
  { name: "chloride_ppm", label: "Cl⁻" },
  { name: "bicarbonate_ppm", label: "HCO₃⁻" },
  { name: "ph", label: "pH" },
] as const;

type IonFieldName = (typeof ION_FIELDS)[number]["name"];

export function WaterProfileQuickCreate({
  onCreated,
}: {
  onCreated: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<WaterProfileFormValues>({
    resolver: zodResolver<WaterProfileFormValues>(waterProfileSchema),
    defaultValues: {
      name: "",
      calcium_ppm: null,
      magnesium_ppm: null,
      sodium_ppm: null,
      sulfate_ppm: null,
      chloride_ppm: null,
      bicarbonate_ppm: null,
      ph: null,
      is_active: true,
    },
  });

  async function onSubmit(values: WaterProfileFormValues) {
    setSaving(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("water_profiles")
        .insert(values)
        .select("id")
        .single();

      if (error) throw error;

      await queryClient.invalidateQueries({
        queryKey: entityKeys.all("water_profiles"),
      });

      toast.success(`Created water profile "${values.name}"`);
      onCreated(data.id);
      setOpen(false);
      reset();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create water profile"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="shrink-0"
          aria-label="Create new water profile"
        >
          <Plus className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          <p className="font-medium text-sm">New Water Profile</p>

          <div>
            <Label htmlFor="qc-wp-name">Name</Label>
            <Input
              id="qc-wp-name"
              placeholder="e.g., Burton-on-Trent"
              className="mt-1"
              {...register("name")}
            />
            {errors.name && (
              <p className="text-xs text-destructive mt-1">
                {errors.name.message}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            {ION_FIELDS.map((ion) => (
              <div key={ion.name}>
                <Label htmlFor={`qc-wp-${ion.name}`} className="text-xs">
                  {ion.label} {ion.name !== "ph" && "(ppm)"}
                </Label>
                <Input
                  id={`qc-wp-${ion.name}`}
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  className="mt-0.5 h-8 text-sm"
                  {...register(ion.name as IonFieldName)}
                />
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(false);
                reset();
              }}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? "Saving..." : "Create"}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
