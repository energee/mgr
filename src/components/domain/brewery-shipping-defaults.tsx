"use client";

/**
 * BreweryShippingDefaults — CRUD editor for brewery_shipping_defaults.
 *
 * Displays one row per material role (pallet, wrap, other). When a default
 * exists for a role, shows the inventory item name with Change/Remove actions.
 * When no default exists, shows "Not set" with a "Set" button.
 *
 * All changes save immediately via mutations. Cache key:
 * materialPlanningKeys.breweryShippingDefaults().
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

type BreweryShippingDefault = {
  id: string;
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

type BreweryShippingDefaultsProps = {
  disabled?: boolean;
};

// =============================================================================
// Component
// =============================================================================

/**
 * Renders one row per material role showing the brewery's default shipping
 * material or a "Not set" fallback. Set, Change, and Remove actions all save
 * immediately.
 */
export function BreweryShippingDefaults({
  disabled = false,
}: BreweryShippingDefaultsProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const { data: defaults = [], isLoading: defaultsLoading } = useQuery({
    queryKey: materialPlanningKeys.breweryShippingDefaults(),
    queryFn: async (): Promise<BreweryShippingDefault[]> => {
      const { data, error } = await dynamicFrom(supabase, "brewery_shipping_defaults")
        .select(
          `id, inventory_item_id, material_role, notes,
           inventory_item:inventory_items(id, name, category, unit_of_measure)`
        );
      if (error) throw error;
      return (data ?? []) as unknown as BreweryShippingDefault[];
    },
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
      queryKey: materialPlanningKeys.breweryShippingDefaults(),
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
      const { error } = await dynamicFrom(supabase, "brewery_shipping_defaults")
        .insert({
          inventory_item_id: item.id,
          material_role: role,
          notes: null,
        } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Default saved");
    },
    onError: () => {
      toast.error("Failed to save default");
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
      const { error } = await dynamicFrom(supabase, "brewery_shipping_defaults")
        .update({ inventory_item_id } as never)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Default updated");
    },
    onError: () => {
      toast.error("Failed to update default");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await dynamicFrom(supabase, "brewery_shipping_defaults")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Default removed");
    },
    onError: () => {
      toast.error("Failed to remove default");
    },
  });

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const isMutating =
    insertMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

  if (defaultsLoading) {
    return (
      <div className="space-y-3">
        {MATERIAL_ROLES.map(({ role }) => (
          <Skeleton key={role} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  const defaultByRole = new Map(defaults.map((d) => [d.material_role, d]));

  return (
    <div className="divide-y rounded-md border">
      {MATERIAL_ROLES.map(({ role, label }) => {
        const defaultItem = defaultByRole.get(role);
        return (
          <RoleRow
            key={role}
            role={role}
            label={label}
            defaultItem={defaultItem ?? null}
            inventoryItems={inventoryItems}
            itemsLoading={itemsLoading}
            disabled={disabled || isMutating}
            onSet={(item) => insertMutation.mutate({ role, item })}
            onChange={(item) =>
              updateMutation.mutate({ id: defaultItem!.id, inventory_item_id: item.id })
            }
            onRemove={() => deleteMutation.mutate(defaultItem!.id)}
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
  defaultItem: BreweryShippingDefault | null;
  inventoryItems: InventoryItem[];
  itemsLoading: boolean;
  disabled: boolean;
  onSet: (item: InventoryItem) => void;
  onChange: (item: InventoryItem) => void;
  onRemove: () => void;
};

/** Renders a single material-role row with inline picker for Set/Change. */
function RoleRow({
  label,
  defaultItem,
  inventoryItems,
  itemsLoading,
  disabled,
  onSet,
  onChange,
  onRemove,
}: RoleRowProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");

  function handleSelect(item: InventoryItem) {
    if (defaultItem) {
      onChange(item);
    } else {
      onSet(item);
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
        {defaultItem ? (
          <p className="text-sm text-foreground">
            {defaultItem.inventory_item?.name ?? defaultItem.inventory_item_id}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Not set</p>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* Set / Change picker */}
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || itemsLoading}
            >
              {defaultItem ? "Change" : "Set"}
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

        {/* Remove only shown when there is a default */}
        {defaultItem && (
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
