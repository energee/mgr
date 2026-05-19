"use client";

/**
 * ShippingMaterialRolesEditor — Shared CRUD editor for material-role-based
 * shipping material preferences.
 *
 * Used by both BreweryShippingDefaults and CustomerShippingPreferences.
 * Displays one row per material role (pallet, wrap, other) with an inventory
 * item picker for set/change and a remove action.
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { dynamicFrom } from "@/services/types";
import { entityKeys } from "@/lib/query-keys";
import { unwrap } from "@/lib/supabase/query-helpers";
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
// Shared types and constants
// =============================================================================

export type MaterialRole = "pallet" | "wrap" | "other";

export const MATERIAL_ROLES: { role: MaterialRole; label: string }[] = [
  { role: "pallet", label: "Pallet" },
  { role: "wrap", label: "Wrap" },
  { role: "other", label: "Other" },
];

type InventoryItem = {
  id: string;
  name: string;
  category: string | null;
  unit: string | null;
};

type ShippingMaterialRow = {
  id: string;
  inventory_item_id: string;
  material_role: MaterialRole;
  notes: string | null;
  inventory_item: {
    id: string;
    name: string;
    category: string | null;
    unit: string | null;
  } | null;
};

/** Groups inventory items by category for the picker. */
export function groupByCategory(items: InventoryItem[]): Record<string, InventoryItem[]> {
  const grouped: Record<string, InventoryItem[]> = {};
  for (const item of items) {
    const cat = item.category ?? "Other";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(item);
  }
  return grouped;
}

// =============================================================================
// Main component
// =============================================================================

type ShippingMaterialRolesEditorProps = {
  /** Supabase table name to query/mutate */
  table: string;
  /** React Query cache key for this editor's data */
  queryKey: readonly unknown[];
  /** Optional customer_id FK — omit for brewery defaults */
  customerId?: string;
  /** Label shown when no item is set for a role */
  emptyLabel?: string;
  /** Label for the primary action button when no item is set */
  setLabel?: string;
  /** Toast noun (e.g., "default", "preference") */
  itemNoun?: string;
  disabled?: boolean;
};

export function ShippingMaterialRolesEditor({
  table,
  queryKey,
  customerId,
  emptyLabel = "Not set",
  setLabel = "Set",
  itemNoun = "item",
  disabled = false,
}: ShippingMaterialRolesEditorProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  // Data fetching
  const { data: rows = [], isLoading: rowsLoading } = useQuery({
    queryKey,
    queryFn: async (): Promise<ShippingMaterialRow[]> => {
      let query = dynamicFrom(supabase, table).select(
        `id, inventory_item_id, material_role, notes,
         inventory_item:inventory_items(id, name, category, unit)`
      );
      if (customerId) {
        query = query.eq("customer_id", customerId);
      }
      return ((await unwrap(query)) ?? []) as unknown as ShippingMaterialRow[];
    },
    enabled: customerId ? !!customerId : true,
  });

  const { data: inventoryItems = [], isLoading: itemsLoading } = useQuery({
    queryKey: entityKeys.list("inventory_items"),
    queryFn: async (): Promise<InventoryItem[]> => {
      return ((await unwrap(
        dynamicFrom(supabase, "inventory_items")
          .select("id, name, category, unit")
          .eq("is_active", true)
          .order("name")
      )) ?? []) as unknown as InventoryItem[];
    },
  });

  const grouped = useMemo(() => groupByCategory(inventoryItems), [inventoryItems]);

  // Mutations
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey });
  };

  const insertMutation = useMutation({
    mutationFn: async ({ role, item }: { role: MaterialRole; item: InventoryItem }) => {
      const row: Record<string, unknown> = {
        inventory_item_id: item.id,
        material_role: role,
        notes: null,
      };
      if (customerId) row.customer_id = customerId;
      await unwrap(dynamicFrom(supabase, table).insert(row as never));
    },
    onSuccess: () => { invalidate(); toast.success(`${itemNoun} saved`); },
    onError: () => { toast.error(`Failed to save ${itemNoun}`); },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, inventory_item_id }: { id: string; inventory_item_id: string }) => {
      await unwrap(
        dynamicFrom(supabase, table).update({ inventory_item_id } as never).eq("id", id)
      );
    },
    onSuccess: () => { invalidate(); toast.success(`${itemNoun} updated`); },
    onError: () => { toast.error(`Failed to update ${itemNoun}`); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await unwrap(dynamicFrom(supabase, table).delete().eq("id", id));
    },
    onSuccess: () => { invalidate(); toast.success(`${itemNoun} removed`); },
    onError: () => { toast.error(`Failed to remove ${itemNoun}`); },
  });

  // Render
  const isMutating =
    insertMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

  if (rowsLoading) {
    return (
      <div className="space-y-3">
        {MATERIAL_ROLES.map(({ role }) => (
          <Skeleton key={role} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  const rowByRole = new Map(rows.map((r) => [r.material_role, r]));

  return (
    <div className="divide-y rounded-md border">
      {MATERIAL_ROLES.map(({ role, label }) => {
        const existing = rowByRole.get(role);
        return (
          <RoleRow
            key={role}
            label={label}
            existing={existing ?? null}
            grouped={grouped}
            itemsLoading={itemsLoading}
            disabled={disabled || isMutating}
            emptyLabel={emptyLabel}
            setLabel={setLabel}
            onSet={(item) => insertMutation.mutate({ role, item })}
            onChange={(item) => {
              if (existing) {
                updateMutation.mutate({ id: existing.id, inventory_item_id: item.id });
              }
            }}
            onRemove={() => {
              if (existing) {
                deleteMutation.mutate(existing.id);
              }
            }}
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
  label: string;
  existing: ShippingMaterialRow | null;
  grouped: Record<string, InventoryItem[]>;
  itemsLoading: boolean;
  disabled: boolean;
  emptyLabel: string;
  setLabel: string;
  onSet: (item: InventoryItem) => void;
  onChange: (item: InventoryItem) => void;
  onRemove: () => void;
};

function RoleRow({
  label,
  existing,
  grouped,
  itemsLoading,
  disabled,
  emptyLabel,
  setLabel,
  onSet,
  onChange,
  onRemove,
}: RoleRowProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");

  function handleSelect(item: InventoryItem) {
    if (existing) {
      onChange(item);
    } else {
      onSet(item);
    }
    setPickerOpen(false);
    setSearchValue("");
  }

  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {existing ? (
          <p className="text-sm text-foreground">
            {existing.inventory_item?.name ?? existing.inventory_item_id}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{emptyLabel}</p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" disabled={disabled || itemsLoading}>
              {existing ? "Change" : setLabel}
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

        {existing && (
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
