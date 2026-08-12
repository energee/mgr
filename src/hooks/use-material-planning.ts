/**
 * Material planning hooks — React-Query wrappers for BOM, shortfalls, order
 * materials, and session material previews used by the packaging material
 * planning UI.
 *
 * These hooks own caching and nothing else. The reads live in
 * `src/services/material-planning-service.ts` and the BOM math in
 * `src/domain/material-planning.ts`, both React-free, so a non-React caller
 * can plan materials without going through this file (backend-extraction T3.1,
 * `docs/plans/backend-extraction.md`).
 *
 * The row types are re-exported here for the existing UI import sites; new
 * code should import them from `@/domain/material-planning`.
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { materialPlanningKeys } from "@/lib/query-keys";
import { filterShortfallsByDemandSource } from "@/domain/material-planning";
import {
  fetchMaterialShortfalls,
  fetchOrderMaterials,
  fetchSellingFormatBOM,
  fetchSessionMaterialPreview,
} from "@/services/material-planning-service";

export type {
  MaterialShortfall,
  OrderMaterial,
  SellingFormatMaterial,
  SessionMaterialPreview,
} from "@/domain/material-planning";

/** Fetch the bill of materials for a selling format. */
export function useSellingFormatBOM(sellingFormatId: string | null) {
  const supabase = createClient();
  return useQuery({
    queryKey: materialPlanningKeys.bom(sellingFormatId ?? ""),
    queryFn: () => fetchSellingFormatBOM(supabase, sellingFormatId!),
    enabled: !!sellingFormatId,
  });
}

/**
 * Calculate material shortfalls across all pending demand.
 *
 * @param options.horizonWeeks - Weeks to look ahead for demand (default: 4)
 * @param options.demandSource - Narrow to one demand source (e.g. "order")
 */
export function useMaterialShortfalls(options?: {
  horizonWeeks?: number;
  demandSource?: string;
}) {
  const supabase = createClient();
  const { horizonWeeks, demandSource } = options ?? {};
  // Cache key excludes demandSource — all source variants share one RPC
  // response per horizon. Client-side filtering via `select` avoids redundant
  // fetches.
  return useQuery({
    queryKey: materialPlanningKeys.shortfalls({ horizonWeeks }),
    queryFn: () => fetchMaterialShortfalls(supabase, horizonWeeks),
    select: (data) => filterShortfallsByDemandSource(data, demandSource),
  });
}

/** Fetch material requirements for a specific order. */
export function useOrderMaterials(orderId: string | null) {
  const supabase = createClient();
  return useQuery({
    queryKey: materialPlanningKeys.orderMaterials(orderId ?? ""),
    queryFn: () => fetchOrderMaterials(supabase, orderId!),
    enabled: !!orderId,
  });
}

/** Compute the display-ready material preview for a packaging session. */
export function useSessionMaterialPreview(sessionId: string | null) {
  const supabase = createClient();
  return useQuery({
    queryKey: materialPlanningKeys.sessionMaterials(sessionId ?? ""),
    queryFn: () => fetchSessionMaterialPreview(supabase, sessionId!),
    enabled: !!sessionId,
  });
}
