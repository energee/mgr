/**
 * Shared hooks for packaging session line items.
 *
 * Provides the data-fetching query (with FK-resolved names and totals)
 * and CRUD mutations consumed by both PackagingDayView and
 * SessionLineItemsEditor.
 */

import { useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { unwrap } from "@/lib/supabase/query-helpers";
import { toast } from "sonner";
import { sessionLineItemKeys, materialPlanningKeys } from "@/lib/query-keys";
import { usePackagingFormats } from "@/hooks/use-catalog";
import { useKegFormatIds } from "@/hooks/use-packaging";

// =============================================================================
// Types
// =============================================================================

export type LineItemRow = {
  id: string;
  brand_id: string;
  brand_name: string;
  batch_id: string | null;
  batch_code: string | null;
  selling_format_id: string | null;
  selling_format_name: string | null;
  keg_owner_id: string | null;
  keg_owner_name: string | null;
  planned_quantity: number | null;
  actual_quantity: number | null;
};

export type NewItemState = {
  brand_id: string;
  format_id: string;
  keg_owner_id: string;
  planned_quantity: number | null;
  actual_quantity: number | null;
  batch_id: string;
};

export const EMPTY_NEW_ITEM: NewItemState = {
  brand_id: "",
  format_id: "",
  keg_owner_id: "",
  planned_quantity: null,
  actual_quantity: null,
  batch_id: "",
};

/** Validate a new item before adding. Returns an error message or null if valid. */
export function validateNewItem(item: NewItemState): string | null {
  if (!item.brand_id) return "Please select a brand";
  if (!item.format_id) return "Please select a format";
  return null;
}

// =============================================================================
// useSessionLineItems — query + totals
// =============================================================================

/**
 * Fetch session line items with FK-resolved names (brand, batch, format,
 * keg owner) and compute planned/actual totals.
 */
export function useSessionLineItems(sessionId: string) {
  const supabase = createClient();

  const { data: items, isLoading } = useQuery({
    queryKey: sessionLineItemKeys.all(sessionId),
    queryFn: async () => {
      const data = await unwrap(
        supabase
          .from("session_line_items")
          .select(
            "*, brands(name), selling_formats(name), keg_owners(name), batches(batch_code)"
          )
          .eq("session_id", sessionId)
          .order("created_at", { ascending: true })
      );

      return data.map((item) => {
        const batchRaw = item.batches as unknown;
        const batchObj = Array.isArray(batchRaw) ? batchRaw[0] : batchRaw;
        return {
          id: item.id,
          brand_id: item.brand_id,
          brand_name:
            (item.brands as { name: string } | null)?.name || "Unknown",
          batch_id: (item as Record<string, unknown>).batch_id as
            | string
            | null,
          batch_code:
            (batchObj as { batch_code: string } | null)?.batch_code || null,
          selling_format_id: item.selling_format_id,
          selling_format_name:
            (item.selling_formats as { name: string } | null)?.name || null,
          keg_owner_id: item.keg_owner_id,
          keg_owner_name:
            (item.keg_owners as { name: string } | null)?.name || null,
          planned_quantity: item.planned_quantity,
          actual_quantity: item.actual_quantity,
        };
      }) as LineItemRow[];
    },
  });

  const { totalPlanned, totalActual } = useMemo(() => {
    const planned =
      items?.reduce((sum, i) => sum + (i.planned_quantity || 0), 0) ?? 0;
    const actual =
      items?.reduce((sum, i) => sum + (i.actual_quantity || 0), 0) ?? 0;
    return { totalPlanned: planned, totalActual: actual };
  }, [items]);

  return { items, isLoading, totalPlanned, totalActual };
}

// =============================================================================
// useLineItemMutations — add, update, delete, format change
// =============================================================================

/**
 * CRUD mutations for session line items. Returns mutation objects and a
 * handleFormatChange helper that clears keg_owner when switching to a
 * non-keg format.
 */
export function useLineItemMutations(sessionId: string) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { data: packagingFormats } = usePackagingFormats();
  const kegFormatIds = useKegFormatIds();

  /**
   * Refresh every cache derived from this session's line items.
   *
   * The "Materials Required" preview (`useSessionMaterialPreview`) is computed
   * straight from `session_line_items` but caches under a sibling namespace
   * (`materialPlanningKeys.sessionMaterials`), so a prefix invalidation of the
   * line-item key alone leaves it showing pre-edit needed/on-hand/shortfall
   * numbers (issue #613). Only the per-session materials key is invalidated —
   * not `materialPlanningKeys.all()` — so unrelated BOM/shortfall/order-material
   * queries on other pages do not refetch on every line edit.
   *
   * All four write paths (add, update, delete, format change) route through
   * here; keep it that way so a new path cannot bypass the materials refresh.
   */
  const invalidateSessionCaches = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: sessionLineItemKeys.all(sessionId),
        }),
        queryClient.invalidateQueries({
          queryKey: materialPlanningKeys.sessionMaterials(sessionId),
        }),
      ]),
    [queryClient, sessionId]
  );

  const addItem = useMutation({
    mutationFn: async (item: NewItemState) => {
      const isKeg = kegFormatIds.has(item.format_id);
      await unwrap(
        supabase.from("session_line_items").insert({
          session_id: sessionId,
          brand_id: item.brand_id,
          selling_format_id: item.format_id || null,
          keg_owner_id: isKeg ? item.keg_owner_id || null : null,
          batch_id: item.batch_id || null,
          planned_quantity: item.planned_quantity,
          actual_quantity: item.actual_quantity,
        })
      );
    },
    onSuccess: () => {
      invalidateSessionCaches();
      toast.success("Line item added");
    },
    onError: () => {
      toast.error("Failed to add line item");
    },
  });

  const updateItem = useMutation({
    mutationFn: async ({
      id,
      field,
      value,
    }: {
      id: string;
      field: string;
      value: unknown;
    }) => {
      await unwrap(
        supabase.from("session_line_items").update({ [field]: value }).eq("id", id)
      );
    },
    onSuccess: invalidateSessionCaches,
    onError: () => {
      toast.error("Failed to update line item");
    },
  });

  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      await unwrap(supabase.from("session_line_items").delete().eq("id", id));
    },
    onSuccess: () => {
      invalidateSessionCaches();
      toast.success("Line item removed");
    },
    onError: () => {
      toast.error("Failed to remove line item");
    },
  });

  /** Update format and clear keg_owner when switching to a non-keg format. */
  const handleFormatChange = async (itemId: string, formatId: string) => {
    const format = packagingFormats?.find((f) => f.id === formatId);
    if (!format) return;

    const updates: Record<string, unknown> = { selling_format_id: formatId };
    if (format.container_type !== "keg") {
      updates.keg_owner_id = null;
    }

    const { error } = await supabase
      .from("session_line_items")
      .update(updates)
      .eq("id", itemId);
    if (error) {
      toast.error("Failed to update format");
      return;
    }
    invalidateSessionCaches();
  };

  return { addItem, updateItem, deleteItem, handleFormatChange, kegFormatIds };
}
