"use client";

/**
 * Tier Settings Component
 *
 * Inline-editable list for managing pricing tier definitions:
 * name, sort order, COGS thresholds, default UPC.
 *
 * Each row manages its own local state (initialized from props)
 * to avoid sync issues between query data and form state.
 */

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { settingsKeys } from "@/lib/query-keys";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Trash2, Save, Layers } from "lucide-react";

// =============================================================================
// Types
// =============================================================================

interface PricingTier {
  id: string;
  name: string;
  sort_order: number;
  default_upc: string | null;
  cogs_min: number | null;
  cogs_max: number | null;
}

interface TierRowProps {
  tier: {
    id: string | null;
    name: string;
    sort_order: number;
    default_upc: string;
    cogs_min: string;
    cogs_max: string;
  };
  onSave: (payload: {
    id: string | null;
    name: string;
    sort_order: number;
    default_upc: string | null;
    cogs_min: number | null;
    cogs_max: number | null;
  }) => void;
  onDelete: (id: string | null) => void;
  saving: boolean;
  deleting: boolean;
}

// =============================================================================
// Row Component — manages its own edit state
// =============================================================================

function TierRow({ tier, onSave, onDelete, saving, deleting }: TierRowProps) {
  const [name, setName] = useState(tier.name);
  const [sortOrder, setSortOrder] = useState(String(tier.sort_order));
  const [defaultUpc, setDefaultUpc] = useState(tier.default_upc);
  const [cogsMin, setCogsMin] = useState(tier.cogs_min);
  const [cogsMax, setCogsMax] = useState(tier.cogs_max);
  const [dirty, setDirty] = useState(!tier.id); // new rows start dirty

  const set = useCallback(
    <T,>(setter: React.Dispatch<React.SetStateAction<T>>) =>
      (value: T) => {
        setter(value);
        setDirty(true);
      },
    []
  );

  const handleSave = () => {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    onSave({
      id: tier.id,
      name: name.trim(),
      sort_order: parseInt(sortOrder) || 0,
      default_upc: defaultUpc.trim() || null,
      cogs_min: cogsMin ? parseFloat(cogsMin) : null,
      cogs_max: cogsMax ? parseFloat(cogsMax) : null,
    });
    setDirty(false);
  };

  return (
    <div className="grid grid-cols-[1fr_80px_1fr_100px_100px_auto_auto] gap-2 items-center">
      <Input
        value={name}
        onChange={(e) => set(setName)(e.target.value)}
        placeholder="Tier name"
        className="h-8 text-sm"
      />
      <Input
        type="number"
        value={sortOrder}
        onChange={(e) => set(setSortOrder)(e.target.value)}
        className="h-8 text-sm"
      />
      <Input
        value={defaultUpc}
        onChange={(e) => set(setDefaultUpc)(e.target.value)}
        placeholder="UPC"
        className="h-8 text-sm"
      />
      <Input
        type="number"
        step="0.01"
        value={cogsMin}
        onChange={(e) => set(setCogsMin)(e.target.value)}
        placeholder="Min"
        className="h-8 text-sm"
      />
      <Input
        type="number"
        step="0.01"
        value={cogsMax}
        onChange={(e) => set(setCogsMax)(e.target.value)}
        placeholder="Max"
        className="h-8 text-sm"
      />
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        disabled={!dirty || saving}
        onClick={handleSave}
      >
        <Save className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-destructive hover:text-destructive"
        disabled={deleting}
        onClick={() => onDelete(tier.id)}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function TierSettings() {
  const supabase = createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const queryClient = useQueryClient();

  // Track new (unsaved) tiers separately
  const [newTiers, setNewTiers] = useState<
    { key: number; sort_order: number }[]
  >([]);
  const [nextKey, setNextKey] = useState(0);

  const { data: tiers, isLoading } = useQuery({
    queryKey: settingsKeys.pricingTiers(),
    queryFn: async () => {
      const { data, error } = await db
        .from("pricing_tiers")
        .select("id, name, sort_order, default_upc, cogs_min, cogs_max")
        .order("sort_order");
      if (error) throw error;
      return data as PricingTier[];
    },
  });

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (payload: {
      id: string | null;
      name: string;
      sort_order: number;
      default_upc: string | null;
      cogs_min: number | null;
      cogs_max: number | null;
    }) => {
      const { id, ...fields } = payload;
      if (id) {
        const { error } = await db
          .from("pricing_tiers")
          .update({ ...fields, updated_at: new Date().toISOString() })
          .eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await db.from("pricing_tiers").insert(fields);
        if (error) throw error;
      }
    },
    onSuccess: (_, payload) => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.pricingTiers() });
      // Remove from newTiers if it was a new tier
      if (!payload.id) {
        setNewTiers([]);
      }
      toast.success(`Tier "${payload.name}" saved`);
    },
    onError: (error) => {
      console.error("Failed to save tier:", error);
      toast.error(error instanceof Error ? error.message : "Failed to save tier");
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (tierId: string) => {
      const { error } = await db
        .from("pricing_tiers")
        .delete()
        .eq("id", tierId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.pricingTiers() });
      toast.success("Tier deleted");
    },
    onError: () => {
      toast.error("Failed to delete tier. It may have prices or recipes assigned.");
    },
  });

  const handleDelete = (id: string | null) => {
    if (id) {
      deleteMutation.mutate(id);
    } else {
      // Remove unsaved new tier
      setNewTiers([]);
    }
  };

  const addTier = () => {
    const maxOrder = Math.max(
      0,
      ...(tiers?.map((t) => t.sort_order) ?? []),
      ...newTiers.map((t) => t.sort_order)
    );
    setNewTiers((prev) => [...prev, { key: nextKey, sort_order: maxOrder + 1 }]);
    setNextKey((k) => k + 1);
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (isLoading) {
    return <div className="text-muted-foreground py-8 text-center">Loading tiers...</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Layers className="h-5 w-5" />
          Pricing Tiers
        </CardTitle>
        <CardDescription>
          Define tiers and their COGS thresholds for auto-assignment
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Header row */}
        <div className="grid grid-cols-[1fr_80px_1fr_100px_100px_auto_auto] gap-2 text-xs font-medium text-muted-foreground px-1">
          <span>Name</span>
          <span>Order</span>
          <span>Default UPC</span>
          <span>COGS Min</span>
          <span>COGS Max</span>
          <span></span>
          <span></span>
        </div>

        {/* Existing tiers */}
        {tiers?.map((tier) => (
          <TierRow
            key={tier.id}
            tier={{
              id: tier.id,
              name: tier.name,
              sort_order: tier.sort_order,
              default_upc: tier.default_upc || "",
              cogs_min: tier.cogs_min != null ? String(tier.cogs_min) : "",
              cogs_max: tier.cogs_max != null ? String(tier.cogs_max) : "",
            }}
            onSave={(p) => saveMutation.mutate(p)}
            onDelete={handleDelete}
            saving={saveMutation.isPending}
            deleting={deleteMutation.isPending}
          />
        ))}

        {/* New (unsaved) tiers */}
        {newTiers.map((nt) => (
          <TierRow
            key={`new-${nt.key}`}
            tier={{
              id: null,
              name: "",
              sort_order: nt.sort_order,
              default_upc: "",
              cogs_min: "",
              cogs_max: "",
            }}
            onSave={(p) => saveMutation.mutate(p)}
            onDelete={handleDelete}
            saving={saveMutation.isPending}
            deleting={false}
          />
        ))}

        <Button variant="outline" size="sm" onClick={addTier} className="mt-2">
          <Plus className="h-4 w-4 mr-1" />
          Add Tier
        </Button>
      </CardContent>
    </Card>
  );
}
