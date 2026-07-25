/**
 * Batch Entity — server-safe core
 *
 * The pure-data half of the batch entity: identity, the zod form schema,
 * state machine, relations, and AI metadata. No React imports — safe to
 * import from server route handlers and API routes.
 *
 * Batches represent the cold-side production process: fermentation through
 * packaging. Hot-side brewing data (brew date, OG, timeline) is captured in
 * brew_logs and linked via brew_log_batches junction table.
 *
 * This decoupling supports:
 * - Split fermentation (1 brew → multiple batches)
 * - Parti-gyle brewing
 * - Blend at knockout
 *
 * Lifecycle: planned → fermenting → conditioning → packaging → completed
 */

import type { EntityCoreInput, StateMachineConfig } from "@/types/entity";
import { statesAsOptions } from "@/types/entity";
import type { Database } from "@/types/supabase";
import { batchSchema, batchStates, batchTransitions } from "@/lib/schemas/batch";

export { batchSchema, type BatchFormValues } from "@/lib/schemas/batch";

// =============================================================================
// Types
// =============================================================================

// Base table type for form operations
type BatchTable = Database["public"]["Tables"]["batches"]["Row"];

// Combined type for entity config: table fields + view computed fields with non-null id
// This is the type used for list/detail display where id is always present
export type Batch = BatchTable & {
  // Computed fields from batches_with_brew_info view
  actual_og: number | null;
  brew_count: number | null;
  brew_date: string | null;
  current_vessel_id: string | null;
  current_vessel_name: string | null;
  current_vessel_type: string | null;
  volume_from_brews_bbl: number | null;
};

// =============================================================================
// State Machine
// =============================================================================

export const batchStateMachine: StateMachineConfig<Batch> = {
  stateField: "status",
  states: [...batchStates],
  initialState: "planned",
  transitions: batchTransitions,
  // Terminating a batch must run the cancel/archive flow (pages intercept via
  // onAction → BatchCancellationDialog → cancel_batch/archive_batch RPCs that
  // release the vessel and record the TTB loss). Suppresses bare status flips.
  requiresAction: {
    cancelled: "cancel",
    archived: "archive",
  },
  stateDisplay: {
    planned: { label: "Planned", color: "default" },
    fermenting: { label: "Fermenting", color: "info" },
    conditioning: { label: "Conditioning", color: "info" },
    packaging: { label: "Packaging", color: "warning" },
    completed: { label: "Completed", color: "success" },
    cancelled: { label: "Cancelled", color: "default" },
    archived: { label: "Archived", color: "error" },
  },
};

// Derive status options from state machine (single source of truth)
export const statusOptions = statesAsOptions(batchStateMachine);

// =============================================================================
// Entity Core
// =============================================================================

export const batchCore: EntityCoreInput<Batch> = {
  name: "batch",
  table: "batches",
  viewTable: "batches_with_brew_info", // Includes brew stats (brew_date, actual_og, brew_count) + current vessel info (id, name, type)
  displayName: "Batch",
  displayNamePlural: "Batches",
  domain: "production",
  basePath: "/production/batches",

  // Explicit: sorted by most-recent planned start first.
  defaultSort: { column: "planned_start_date", direction: "desc" },
  searchableFields: ["batch_code", "name"],

  detailHeader: {
    title: "batch_code",
    subtitle: "name",
    badge: "status",
  },

  formSchema: batchSchema,

  stateMachine: batchStateMachine,

  relations: [
    {
      name: "recipe",
      entity: "recipe",
      type: "belongsTo",
      foreignKey: "recipe_id",
      showInDetail: true,
    },
    {
      name: "recipe_variant",
      entity: "recipe_variant",
      type: "belongsTo",
      foreignKey: "recipe_variant_id",
      showInDetail: false,
    },
    {
      name: "brew_logs",
      entity: "brew_log",
      type: "hasManyThrough",
      through: "brew_log_batches",
      foreignKey: "batch_id",
      showInDetail: true,
      detailTab: "Brew Logs",
    },
    {
      name: "vessel_transfers",
      entity: "vessel_transfer",
      type: "hasMany",
      foreignKey: "batch_id",
      showInDetail: true,
      detailTab: "Transfers",
      hideAdd: true,
    },
    {
      name: "yeast_events",
      entity: "yeast_pitch_event",
      type: "hasMany",
      foreignKey: "batch_id",
      showInDetail: false, // shown via custom BatchYeastSection
    },
  ],

  keyFields: ["batch_code", "name", "status", "planned_start_date", "current_vessel_name"],
};
