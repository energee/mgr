/**
 * Packaging Session Entity — server-safe core
 *
 * The pure-data half of the packaging session entity: identity, the zod form
 * schema, state machine, relations, and AI metadata. No React imports — safe
 * to import from server route handlers and API routes.
 *
 * Packaging sessions track kegging, canning, and bottling runs. Each session
 * can contain multiple line items (products from different batches).
 *
 * Lifecycle: planned → in_progress → completed → revised | cancelled
 *
 * Note: "revised" and "cancelled" are terminal states. "Revised" indicates
 * the session was completed but later adjusted (e.g., quantity corrections).
 * Historical record is preserved; to re-run packaging, create a new session.
 */

import { z } from "zod";
import type { EntityCoreInput, StateMachineConfig } from "@/types/entity";
import { statesAsOptions } from "@/types/entity";
import type { Database } from "@/types/supabase";

type PackagingSessionTable = Database["public"]["Tables"]["packaging_sessions"]["Row"];

// Combined type: base table + computed fields from view
export type PackagingSession = PackagingSessionTable & {
  line_count: number | null;
  brands: string | null;
  total_planned: number | null;
  total_actual: number | null;
  total_variance: number | null;
};

// =============================================================================
// Zod Schema
// =============================================================================

export const packagingSessionSchema = z.object({
  session_date: z.string().min(1, "Session date is required"),
  status: z.string().default("planned"),
  notes: z.string().nullable().optional(),
});

export type PackagingSessionFormValues = z.infer<typeof packagingSessionSchema>;

// =============================================================================
// State Machine
// =============================================================================

export const packagingSessionStateMachine: StateMachineConfig<PackagingSession> = {
  stateField: "status",
  states: ["planned", "in_progress", "completed", "revised", "cancelled"],
  initialState: "planned",
  transitions: {
    planned: ["in_progress", "cancelled"],
    in_progress: ["completed", "cancelled"],
    completed: ["revised"],
    revised: [],
    cancelled: [],
  },
  // Reaching "revised" requires the interactive revise flow (quantity edits +
  // finished-goods/material adjustments via revise_packaging_session, 00184) —
  // suppresses the generic "Move to Revised" in favor of the "revise" action.
  // A DB trigger blocks bare status UPDATEs into "revised" as the backstop.
  requiresAction: {
    revised: "revise",
  },
  stateDisplay: {
    planned: { label: "Planned", color: "default" },
    in_progress: { label: "In Progress", color: "info" },
    completed: { label: "Completed", color: "success" },
    revised: { label: "Revised", color: "warning" },
    cancelled: { label: "Cancelled", color: "error" },
  },
};

export const statusOptions = statesAsOptions(packagingSessionStateMachine);

// =============================================================================
// Entity Core
// =============================================================================

export const packagingSessionCore: EntityCoreInput<PackagingSession> = {
  name: "packaging_session",
  table: "packaging_sessions",
  viewTable: "packaging_sessions_with_summary",
  displayName: "Packaging Session",
  description: "Track kegging, canning, and bottling runs",
  domain: "production",
  basePath: "/production/packaging",

  // Explicit: sorted by most-recent session first.
  defaultSort: { column: "session_date", direction: "desc" },
  searchableFields: ["notes", "brands"],

  stateMachine: packagingSessionStateMachine,

  detailHeader: {
    title: "session_date",
    badge: "status",
  },

  formSchema: packagingSessionSchema,

  // Note: Line items use inline editing via SessionLineItemsDisplay component,
  // not the standard relation tab rendering. Relation kept for query/reference.
  relations: [
    {
      name: "line_items",
      entity: "session_line_item",
      type: "hasMany",
      foreignKey: "session_id",
      showInDetail: false, // Using custom component instead
    },
  ],

  queryExamples: [
    "Show all packaging sessions this week",
    "What sessions are in progress?",
    "List completed sessions for January",
    "Show sessions with line items for brand X",
  ],

  keyFields: ["session_date", "status"],
};
