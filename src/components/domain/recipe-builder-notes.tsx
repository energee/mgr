"use client";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Database } from "@/types/supabase";

type RecipeRow = Database["public"]["Tables"]["recipes"]["Row"];

interface RecipeBuilderNotesProps {
  recipe: RecipeRow;
  onFieldChange: (fields: Partial<RecipeRow>) => void;
}

export function RecipeBuilderNotes({
  recipe,
  onFieldChange,
}: RecipeBuilderNotesProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="brew_day_notes">Brew Day Notes</Label>
        <Textarea
          id="brew_day_notes"
          value={recipe.brew_day_notes || ""}
          onChange={(e) => onFieldChange({ brew_day_notes: e.target.value || null })}
          placeholder="Special instructions for brew day..."
          rows={3}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="tasting_notes">Tasting Notes</Label>
        <Textarea
          id="tasting_notes"
          value={recipe.tasting_notes || ""}
          onChange={(e) => onFieldChange({ tasting_notes: e.target.value || null })}
          placeholder="Flavor, aroma, appearance..."
          rows={3}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="development_notes">Development Notes</Label>
        <Textarea
          id="development_notes"
          value={recipe.development_notes || ""}
          onChange={(e) =>
            onFieldChange({ development_notes: e.target.value || null })
          }
          placeholder="Recipe development history, variations tried..."
          rows={3}
        />
      </div>
    </div>
  );
}
