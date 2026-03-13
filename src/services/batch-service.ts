/**
 * Batch Domain Service
 *
 * Batch-specific operations (RPC performance analysis, blend candidate queries)
 * in the ServiceResult pattern. Consolidates logic previously duplicated
 * between AI chat tools and the batch-insights component.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { type ServiceResult, ok, err, parseSupabaseError, dynamicRpc, dynamicFrom } from "./types";

/** Result from the analyze_batch_performance RPC function. */
export type BatchPerformanceReport = {
  batch_id: string;
  batch_number: string;
  recipe_name: string;
  status: string;
  metrics: {
    og: { target: number | null; actual: number | null; variance: number | null };
    fg: { target: number | null; actual: number | null; variance: number | null };
    abv: { target: number | null; actual: number | null; variance: number | null };
    efficiency: { target: number | null; actual: number | null; variance: number | null };
    volume: { target: number | null; actual: number | null; variance: number | null };
  };
  timeline: {
    planned_start: string | null;
    actual_start: string | null;
    planned_end: string | null;
    actual_end: string | null;
    days_in_production: number | null;
  };
  quality_notes: string[];
}

/** Lightweight batch record for blend candidate selection. */
export type BlendCandidate = {
  id: string;
  batch_number: string;
  recipe_name: string;
  status: string;
  volume_bbl: number | null;
  current_vessel_name: string | null;
}

export const batchService = {
  /**
   * Analyze a batch's performance against its recipe targets.
   * Wraps the `analyze_batch_performance` RPC function.
   */
  async analyzePerformance(
    supabase: SupabaseClient<Database>,
    batchId: string
  ): Promise<ServiceResult<BatchPerformanceReport>> {
    try {
      const { data, error } = await dynamicRpc(supabase,
        "analyze_batch_performance",
        { p_batch_id: batchId }
      );

      if (error) {
        return err(parseSupabaseError(error, { table: "batches", id: batchId }));
      }

      return ok(data as BatchPerformanceReport);
    } catch (e) {
      return err({
        code: "UNKNOWN",
        message: `Failed to analyze batch performance: ${e instanceof Error ? e.message : String(e)}`,
        cause: e,
      });
    }
  },

  /**
   * Get batches that are eligible for blending with a given batch.
   * Finds batches in compatible states with available volume.
   */
  async getBlendCandidates(
    supabase: SupabaseClient<Database>,
    batchId: string
  ): Promise<ServiceResult<BlendCandidate[]>> {
    try {
      // Get the source batch's recipe to find compatible batches
      const { data: sourceBatch, error: fetchError } = await dynamicFrom(supabase, "batches")
        .select("id, recipe_id, status")
        .eq("id", batchId)
        .single();

      if (fetchError) {
        return err(parseSupabaseError(fetchError, { table: "batches", id: batchId }));
      }

      // Find other batches of the same recipe in blendable states
      const { data: candidates, error: listError } = await dynamicFrom(supabase, "batches_with_brew_info")
        .select("id, batch_number, recipe_name, status, volume_bbl, current_vessel_name")
        .eq("recipe_id", sourceBatch.recipe_id)
        .neq("id", batchId)
        .in("status", ["fermenting", "conditioning", "packaging"]);

      if (listError) {
        return err(parseSupabaseError(listError, { table: "batches" }));
      }

      return ok((candidates ?? []) as BlendCandidate[]);
    } catch (e) {
      return err({
        code: "UNKNOWN",
        message: `Failed to get blend candidates: ${e instanceof Error ? e.message : String(e)}`,
        cause: e,
      });
    }
  },
};
