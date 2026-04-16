"use client";

/**
 * CustomerShippingPreferences — CRUD editor for customer_shipping_materials.
 *
 * Displays one row per material role (pallet, wrap, other). When a customer has
 * a preference for a role, shows the inventory item name with Change/Remove
 * actions. When no preference exists, shows "Using brewery default" with an
 * Override button to set a customer-specific item.
 *
 * All changes save immediately via mutations. Cache key:
 * materialPlanningKeys.customerShippingMaterials(customerId).
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { dynamicFrom } from "@/services/types";
import { materialPlanningKeys, entityKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "sonner";

// =============================================================================
// Types
// =============================================================================

type MaterialRole = "pallet" | "wrap" | "other";

const MATERIAL_ROLES: { role: MaterialRole; label: string }[] = [
  { role: "pallet", label: "Pallet" },
  { role: "wrap", label: "Wrap" },
  { role: "other", label: "Other" },
];

type CustomerShippingMaterial = {
  id: string;
  customer_id: string;
  inventory_item_id: string;
  material_role: MaterialRole;
  notes: string | null;
  inventory_item: {
    id: string;
    name: string;
    category: string | null;
    unit_of_measure: string | null;
  } | null;
};

type InventoryItem = {
  id: string;
  name: string;
  category: string | null;
  unit_of_measure: string | null;
};

type CustomerShippingPreferencesProps = {
  customerId: string;
  disabled?: boolean;
};

// =============================================================================
// Component
// =============================================================================

/**
 * Renders one row per material role showing the customer's override preference
 * or a "Using brewery default" fallback. Override, Change, and Remove actions
 * all save immediately.
 */
export function CustomerShippingPreferences({
  customerId,
  disabled = false,
}: CustomerShippingPreferencesProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const { data: preferences = [], isLoading: prefsLoading } = useQuery({
    queryKey: materialPlanningKeys.customerShippingMaterials(customerId),
    queryFn: async (): Promise<CustomerShippingMaterial[]> => {
      const { data, error } = await dynamicFrom(supabase, "customer_shipping_materials")
        .select(
          `id, customer_id, inventory_item_id, material_role, notes,
           inventory_item:inventory_items(id, name, category, unit_of_measure)`
        )
        .eq("customer_id", customerId);
      if (error) throw error;
      return (data ?? []) as unknown as CustomerShippingMaterial[];
    },
    enabled: !!customerId,
  });

  const { data: inventoryItems = [], isLoading: itemsLoading } = useQuery({
    queryKey: entityKeys.list("inventory_items"),
    queryFn: async (): Promise<InventoryItem[]> => {
      const { data, error } = await dynamicFrom(supabase, "inventory_items")
        .select("id, name, category, unit_of_measure")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as unknown as InventoryItem[];
    },
  });

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  const invalidate = () => {
    queryClient.invalidateQueries({
      queryKey: materialPlanningKeys.customerShippingMaterials(customerId),
    });
  };

  const insertMutation = useMutation({
    mutationFn: async ({
      role,
      item,
    }: {
      role: MaterialRole;
      item: InventoryItem;
    }) => {
      const { error } = await dynamicFrom(supabase, "customer_shipping_materials")
        .insert({
          customer_id: customerId,
          inventory_item_id: item.id,
          material_role: role,
          notes: null,
        } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Preference saved");
    },
    onError: () => {
      toast.error("Failed to save preference");
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      inventory_item_id,
    }: {
      id: string;
      inventory_item_id: string;
    }) => {
      const { error } = await dynamicFrom(supabase, "customer_shipping_materials")
        .update({ inventory_item_id } as never)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Preference updated");
    },
    onError: () => {
      toast.error("Failed to update preference");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await dynamicFrom(supabase, "customer_shipping_materials")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Preference removed");
    },
    onError: () => {
      toast.error("Failed to remove preference");
    },
  });

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const isMutating =
    insertMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

  if (prefsLoading) {
    return (
      <div className="space-y-3">
        {MATERIAL_ROLES.map(({ role }) => (
          <Skeleton key={role} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  const prefByRole = new Map(preferences.map((p) => [p.material_role, p]));

  return (
    <div className="divide-y rounded-md border">
      {MATERIAL_ROLES.map(({ role, label }) => {
        const pref = prefByRole.get(role);
        return (
          <RoleRow
            key={role}
            role={role}
            label={label}
            preference={pref ?? null}
            inventoryItems={inventoryItems}
            itemsLoading={itemsLoading}
            disabled={disabled || isMutating}
            onOverride={(item) => insertMutation.mutate({ role, item })}
            onChange={(item) => updateMutation.mutate({ id: pref!.id, inventory_item_id: item.id })}
            onRemove={() => deleteMutation.mutate(pref!.id)}
          />
        );
      })}
    </div>
  );
}

// =============================================================================
// RoleRow — one row per material role
// =============================================================================

type RoleRowProps = {
  role: MaterialRole;
  label: string;
  preference: CustomerShippingMaterial | null;
  inventoryItems: InventoryItem[];
  itemsLoading: boolean;
  disabled: boolean;
  onOverride: (item: InventoryItem) => void;
  onChange: (item: InventoryItem) => void;
  onRemove: () => void;
};

/** Renders a single material-role row with inline picker for Override/Change. */
function RoleRow({
  label,
  preference,
  inventoryItems,
  itemsLoading,
  disabled,
  onOverride,
  onChange,
  onRemove,
}: RoleRowProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");

  function handleSelect(item: InventoryItem) {
    if (preference) {
      onChange(item);
    } else {
      onOverride(item);
    }
    setPickerOpen(false);
    setSearchValue("");
  }

  // Group items by category for the picker
  const grouped: Record<string, InventoryItem[]> = {};
  for (const item of inventoryItems) {
    const cat = item.category ?? "Other";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(item);
  }

  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {preference ? (
          <p className="text-sm text-foreground">
            {preference.inventory_item?.name ?? preference.inventory_item_id}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Using brewery default</p>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* Override / Change picker */}
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || itemsLoading}
            >
              {preference ? "Change" : "Override"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[320px] p-0" align="end">
            <Command>
              <CommandInput
                placeholder="Search inventory items..."
                value={searchValue}
                onValueChange={setSearchValue}
              />
              <CommandList>
                <CommandEmpty>No items found.</CommandEmpty>
                {Object.entries(grouped).map(([category, items]) => (
                  <CommandGroup key={category} heading={category}>
                    {items.map((item) => (
                      <CommandItem
                        key={item.id}
                        value={`${item.name} ${item.category ?? ""}`}
                        onSelect={() => handleSelect(item)}
                      >
                        <span>{item.name}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {/* Remove only shown when there is a preference */}
        {preference && (
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={onRemove}
            className="text-muted-foreground hover:text-destructive"
          >
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}
