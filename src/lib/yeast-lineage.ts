/**
 * Yeast Lineage Utilities
 *
 * Shared logic for resolving yeast lineage root IDs. Used by both the
 * yeast pitch detail page and the lineage display component.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { dynamicRpc } from "@/services/types";

/**
 * Resolves the root pitch ID for a yeast lineage. Tries the server-side
 * `get_yeast_lineage_root` RPC first (single recursive CTE, no N+1).
 * Falls back to walking the parent chain client-side if the RPC is
 * unavailable (e.g. stale PostgREST schema cache).
 */
export async function resolveYeastLineageRoot(
  supabase: SupabaseClient,
  pitchId: string
): Promise<string> {
  const { data: rpcResult, error: rpcError } = await dynamicRpc(
    supabase,
    "get_yeast_lineage_root",
    { p_pitch_id: pitchId }
  );
  if (!rpcError && rpcResult) return rpcResult as string;

  // Fallback: walk up parent chain via the view
  let currentId = pitchId;
  for (;;) {
    const { data: pitch } = await supabase
      .from("yeast_pitches_with_remaining")
      .select("id, parent_pitch_id, source_type")
      .eq("id", currentId)
      .single();

    if (!pitch || !pitch.parent_pitch_id || pitch.source_type === "purchase") {
      return pitch?.id ?? pitchId;
    }
    currentId = pitch.parent_pitch_id;
  }
}
