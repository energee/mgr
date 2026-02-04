"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { dynamicOptionsKeys } from "@/lib/query-keys";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Database } from "@/types/supabase";

type RecipeRow = Database["public"]["Tables"]["recipes"]["Row"];

interface RecipeBuilderBasicsProps {
  recipe: RecipeRow;
  onFieldChange: (fields: Partial<RecipeRow>) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTable = any;

function useOptions(table: string, labelField: string, orderBy: string) {
  const supabase = createClient();
  return useQuery({
    queryKey: dynamicOptionsKeys.field(table, "id"),
    queryFn: async () => {
      const { data, error } = await supabase
        .from(table as AnyTable)
        .select(`id, ${labelField}`)
        .order(orderBy);
      if (error) throw error;
      return data as unknown as { id: string; [key: string]: unknown }[];
    },
  });
}

export function RecipeBuilderBasics({
  recipe,
  onFieldChange,
}: RecipeBuilderBasicsProps) {
  const { data: brands = [] } = useOptions("brands", "name", "name");
  const { data: styles = [] } = useOptions("beer_styles", "name", "name");

  return (
    <div className="space-y-4">
      {/* Row 1: Name + Brand */}
      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-6 space-y-1.5">
          <Label htmlFor="name">Recipe Name</Label>
          <Input
            id="name"
            value={recipe.name || ""}
            onChange={(e) => onFieldChange({ name: e.target.value })}
            placeholder="e.g., Hazy Days IPA"
          />
        </div>
        <div className="col-span-6 space-y-1.5">
          <Label htmlFor="brand_id">Brand</Label>
          <Select
            value={recipe.brand_id || "_none"}
            onValueChange={(v) =>
              onFieldChange({ brand_id: v === "_none" ? null : v })
            }
          >
            <SelectTrigger id="brand_id">
              <SelectValue placeholder="Select brand..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_none">No brand</SelectItem>
              {brands.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name as string}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Row 2: Style + Volume + Batch Size + Boil Time */}
      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-4 space-y-1.5">
          <Label htmlFor="style_id">Style</Label>
          <Select
            value={recipe.style_id || "_none"}
            onValueChange={(v) =>
              onFieldChange({ style_id: v === "_none" ? null : v })
            }
          >
            <SelectTrigger id="style_id">
              <SelectValue placeholder="Select style..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_none">No style</SelectItem>
              {styles.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name as string}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="volume_bbl">Volume (BBL)</Label>
          <Input
            id="volume_bbl"
            type="number"
            value={recipe.volume_bbl ?? ""}
            onChange={(e) =>
              onFieldChange({
                volume_bbl: e.target.value ? Number(e.target.value) : null,
              })
            }
            placeholder="e.g., 7"
          />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="batch_size_bbl">Batch Size (BBL)</Label>
          <Input
            id="batch_size_bbl"
            type="number"
            value={recipe.batch_size_bbl ?? ""}
            onChange={(e) =>
              onFieldChange({
                batch_size_bbl: e.target.value
                  ? Number(e.target.value)
                  : null,
              })
            }
            placeholder="e.g., 7"
          />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="boil_time_min">Boil (min)</Label>
          <Input
            id="boil_time_min"
            type="number"
            value={recipe.boil_time_min ?? ""}
            onChange={(e) =>
              onFieldChange({
                boil_time_min: e.target.value
                  ? Number(e.target.value)
                  : null,
              })
            }
            placeholder="e.g., 60"
          />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="status">Status</Label>
          <Select
            value={recipe.status || "draft"}
            onValueChange={(v) => onFieldChange({ status: v })}
          >
            <SelectTrigger id="status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="spec">Spec</SelectItem>
              <SelectItem value="complete">Complete</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Row 3: Switches */}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <Switch
            id="is_template"
            checked={recipe.is_template ?? false}
            onCheckedChange={(v) => onFieldChange({ is_template: v })}
          />
          <Label htmlFor="is_template" className="text-sm font-normal">
            Template
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="is_active"
            checked={recipe.is_active ?? true}
            onCheckedChange={(v) => onFieldChange({ is_active: v })}
          />
          <Label htmlFor="is_active" className="text-sm font-normal">
            Active
          </Label>
        </div>
      </div>
    </div>
  );
}
