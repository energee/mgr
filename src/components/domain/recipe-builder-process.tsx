"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Database } from "@/types/supabase";

type RecipeRow = Database["public"]["Tables"]["recipes"]["Row"];

interface RecipeBuilderProcessProps {
  recipe: RecipeRow;
  onFieldChange: (fields: Partial<RecipeRow>) => void;
}

export function RecipeBuilderProcess({
  recipe,
  onFieldChange,
}: RecipeBuilderProcessProps) {
  const numField = (
    field: keyof RecipeRow,
    label: string,
    placeholder: string
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={field}>{label}</Label>
      <Input
        id={field}
        type="number"
        value={(recipe[field] as number | null) ?? ""}
        onChange={(e) =>
          onFieldChange({
            [field]: e.target.value ? Number(e.target.value) : null,
          })
        }
        placeholder={placeholder}
      />
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {numField("boil_time_min", "Boil Time (min)", "60")}
        {numField("whirlpool_time_min", "Whirlpool (min)", "20")}
        {numField("whirlpool_temp_f", "Whirlpool Temp (°F)", "180")}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {numField("whirlpool_rest_min", "Rest Time (min)", "15")}
        {numField("target_ko_temp_f", "KO Temp (°F)", "65")}
        {numField("target_ko_volume_bbl", "KO Volume (BBL)", "7")}
      </div>
    </div>
  );
}
