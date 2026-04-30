"use client";

/**
 * CustomerPalletConfigs — CRUD editor for customer_pallet_configs.
 *
 * Displays a table of per-selling-format pallet layer overrides for a customer.
 * Columns: Selling Format name, Units Per Layer (read-only from selling_format),
 * Layers (editable, saves on blur), Effective Pallet Qty (computed inline).
 *
 * Provides an "Add Format" button to create a new override and a Delete button
 * per row for removal.
 *
 * Cache key: materialPlanningKeys.customerPalletConfigs(customerId).
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { dynamicFrom } from "@/services/types";
import { materialPlanningKeys, entityKeys } from "@/lib/query-keys";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

// =============================================================================
// Types
// =============================================================================

type CustomerPalletConfig = {
  id: string;
  customer_id: string;
  selling_format_id: string;
  layers: number | null;
  notes: string | null;
  selling_format: {
    id: string;
    name: string;
    units_per_layer: number | null;
  } | null;
};

type SellingFormat = {
  id: string;
  name: string;
  units_per_layer: number | null;
};

type CustomerPalletConfigsProps = {
  customerId: string;
  disabled?: boolean;
};

// =============================================================================
// Component
// =============================================================================

/**
 * Renders pallet layer overrides per selling format for a customer.
 * Layers are editable in-line and saved on blur; effective pallet qty is computed.
 */
export function CustomerPalletConfigs({
  customerId,
  disabled = false,
}: CustomerPalletConfigsProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const { data: configs = [], isLoading: configsLoading } = useQuery({
    queryKey: materialPlanningKeys.customerPalletConfigs(customerId),
    queryFn: async (): Promise<CustomerPalletConfig[]> => {
      const { data, error } = await dynamicFrom(supabase, "customer_pallet_configs")
        .select(
          `id, customer_id, selling_format_id, layers, notes,
           selling_format:selling_formats(id, name, units_per_layer)`
        )
        .eq("customer_id", customerId)
        .order("selling_format_id");
      if (error) throw error;
      return (data ?? []) as unknown as CustomerPalletConfig[];
    },
    enabled: !!customerId,
  });

  const { data: sellingFormats = [], isLoading: formatsLoading } = useQuery({
    queryKey: entityKeys.list("selling_formats"),
    queryFn: async (): Promise<SellingFormat[]> => {
      const { data, error } = await dynamicFrom(supabase, "selling_formats")
        .select("id, name, units_per_layer")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as unknown as SellingFormat[];
    },
  });

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  const invalidate = () => {
    queryClient.invalidateQueries({
      queryKey: materialPlanningKeys.customerPalletConfigs(customerId),
    });
  };

  const insertMutation = useMutation({
    mutationFn: async (format: SellingFormat) => {
      const { error } = await dynamicFrom(supabase, "customer_pallet_configs")
        .insert({
          customer_id: customerId,
          selling_format_id: format.id,
          layers: 1,
          notes: null,
        } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Format added");
    },
    onError: () => {
      toast.error("Failed to add format");
    },
  });

  const updateLayersMutation = useMutation({
    mutationFn: async ({ id, layers }: { id: string; layers: number | null }) => {
      const { error } = await dynamicFrom(supabase, "customer_pallet_configs")
        .update({ layers } as never)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
    },
    onError: () => {
      toast.error("Failed to save layers");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await dynamicFrom(supabase, "customer_pallet_configs")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Format removed");
    },
    onError: () => {
      toast.error("Failed to remove format");
    },
  });

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const isMutating =
    insertMutation.isPending ||
    updateLayersMutation.isPending ||
    deleteMutation.isPending;

  // Filter out selling formats that already have a config row
  const configuredIds = new Set(configs.map((c) => c.selling_format_id));
  const availableFormats = sellingFormats.filter((f) => !configuredIds.has(f.id));

  if (configsLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Add Format button */}
      <div className="flex items-center justify-end">
        <Popover open={addOpen} onOpenChange={setAddOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || isMutating || formatsLoading || availableFormats.length === 0}
              className="gap-1"
            >
              <Plus className="h-4 w-4" />
              Add Format
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[320px] p-0" align="end">
            <Command>
              <CommandInput
                placeholder="Search selling formats..."
                value={searchValue}
                onValueChange={setSearchValue}
              />
              <CommandList>
                <CommandEmpty>No formats available.</CommandEmpty>
                <CommandGroup>
                  {availableFormats.map((format) => (
                    <CommandItem
                      key={format.id}
                      value={format.name}
                      onSelect={() => {
                        insertMutation.mutate(format);
                        setAddOpen(false);
                        setSearchValue("");
                      }}
                    >
                      <div className="flex flex-col">
                        <span>{format.name}</span>
                        {format.units_per_layer != null && (
                          <span className="text-xs text-muted-foreground">
                            {format.units_per_layer} units/layer
                          </span>
                        )}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {/* Configs table or empty state */}
      {configs.length === 0 ? (
        <div className="border rounded-md p-8 text-center text-muted-foreground">
          <p>No pallet configurations defined.</p>
          <p className="text-sm mt-1">
            Add a selling format override to specify custom layer counts for this customer.
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Selling Format</TableHead>
              <TableHead className="w-36 text-right">Units Per Layer</TableHead>
              <TableHead className="w-28">Layers</TableHead>
              <TableHead className="w-36 text-right">Effective Qty</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {configs.map((row) => (
              <PalletConfigRow
                key={row.id}
                row={row}
                disabled={disabled || isMutating}
                onLayersBlur={(layers) =>
                  updateLayersMutation.mutate({ id: row.id, layers })
                }
                onDelete={() => deleteMutation.mutate(row.id)}
              />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

// =============================================================================
// PalletConfigRow — individual editable row
// =============================================================================

type PalletConfigRowProps = {
  row: CustomerPalletConfig;
  disabled: boolean;
  onLayersBlur: (layers: number | null) => void;
  onDelete: () => void;
};

/** A single pallet config row with editable layers field. */
function PalletConfigRow({
  row,
  disabled,
  onLayersBlur,
  onDelete,
}: PalletConfigRowProps) {
  const [layersValue, setLayersValue] = useState(
    row.layers != null ? String(row.layers) : ""
  );

  const sf = row.selling_format;
  const unitsPerLayer = sf?.units_per_layer ?? null;
  const layers = layersValue.trim() === "" ? null : parseInt(layersValue, 10);
  const effectiveQty =
    unitsPerLayer != null && layers != null && !isNaN(layers)
      ? unitsPerLayer * layers
      : null;

  function handleBlur() {
    const parsed =
      layersValue.trim() === "" ? null : parseInt(layersValue, 10);
    const newLayers = parsed !== null && isNaN(parsed) ? null : parsed;
    if (newLayers !== row.layers) {
      onLayersBlur(newLayers);
    }
  }

  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{sf?.name ?? row.selling_format_id}</div>
      </TableCell>
      <TableCell className="text-right text-muted-foreground">
        {unitsPerLayer ?? "—"}
      </TableCell>
      <TableCell>
        <Input
          type="number"
          step="1"
          min="1"
          value={layersValue}
          placeholder="—"
          onChange={(e) => setLayersValue(e.target.value)}
          onBlur={handleBlur}
          disabled={disabled}
          className="w-20"
        />
      </TableCell>
      <TableCell className="text-right text-muted-foreground">
        {effectiveQty ?? "—"}
      </TableCell>
      <TableCell>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDelete}
          disabled={disabled}
          className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
}
