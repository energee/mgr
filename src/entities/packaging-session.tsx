/**
 * Packaging Session Entity Configuration
 *
 * Packaging sessions track kegging, canning, and bottling runs.
 * Each session can contain multiple line items (products from different batches).
 *
 * Lifecycle: planned → in_progress → completed → revised | cancelled
 *
 * Note: "revised" and "cancelled" are terminal states. "Revised" indicates
 * the session was completed but later adjusted (e.g., quantity corrections).
 * Historical record is preserved; to re-run packaging, create a new session.
 */

import { z } from "zod";
import type { EntityConfig, StateMachineConfig } from "@/types/entity";
import { statesAsOptions } from "@/types/entity";
import type { Database } from "@/types/supabase";

type PackagingSession = Database["public"]["Tables"]["packaging_sessions"]["Row"];

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

const packagingSessionStateMachine: StateMachineConfig<PackagingSession> = {
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
  stateDisplay: {
    planned: { label: "Planned", color: "default" },
    in_progress: { label: "In Progress", color: "info" },
    completed: { label: "Completed", color: "success" },
    revised: { label: "Revised", color: "warning" },
    cancelled: { label: "Cancelled", color: "error" },
  },
};

const statusOptions = statesAsOptions(packagingSessionStateMachine);

// =============================================================================
// Entity Configuration
// =============================================================================

export const packagingSessionEntity: EntityConfig<PackagingSession> = {
  // ---------------------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------------------
  name: "packaging_session",
  table: "packaging_sessions",
  displayName: "Packaging Session",
  displayNamePlural: "Packaging Sessions",
  description: "Track kegging, canning, and bottling runs",
  domain: "production",

  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "id",
      header: "Session ID",
      sortable: true,
      render: (value) => String(value).slice(0, 8),
    },
    {
      accessorKey: "session_date",
      header: "Date",
      sortable: true,
    },
    {
      accessorKey: "status",
      header: "Status",
      sortable: true,
    },
    {
      accessorKey: "notes",
      header: "Notes",
      render: (value) => value ? String(value).slice(0, 50) + (String(value).length > 50 ? "..." : "") : "—",
    },
  ],

  listFilters: [
    {
      field: "status",
      type: "select",
      label: "Status",
      options: statusOptions,
    },
  ],

  defaultSort: { column: "session_date", direction: "desc" },
  searchableFields: ["notes"],

  // ---------------------------------------------------------------------------
  // State Machine
  // ---------------------------------------------------------------------------
  stateMachine: packagingSessionStateMachine,

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "session_date",
    badge: "status",
  },

  detailSections: [
    {
      id: "overview",
      title: "Session Details",
      fields: [
        { field: "id", label: "Session ID" },
        { field: "session_date", label: "Date" },
        { field: "status", label: "Status" },
        { field: "created_at", label: "Created" },
        { field: "updated_at", label: "Last Updated" },
      ],
    },
    {
      id: "notes",
      title: "Notes",
      fields: [
        { field: "notes", label: "Notes", fullWidth: true },
      ],
      collapsible: true,
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: packagingSessionSchema,

  formFields: [
    {
      name: "session_date",
      label: "Session Date",
      type: "date",
      required: true,
      colSpan: 6,
    },
    {
      name: "status",
      label: "Status",
      type: "select",
      options: statusOptions,
      colSpan: 6,
    },
    {
      name: "notes",
      label: "Notes",
      type: "textarea",
      placeholder: "Session notes, special instructions, etc.",
      colSpan: 12,
    },
  ],

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------
  // TODO: Create session_line_item entity config when implementing line item management.
  // The database table exists (packaging_session_items) but the entity config is not yet created.
  // Until then, the "Line Items" tab will not render properly on the detail page.
  relations: [
    {
      name: "line_items",
      entity: "session_line_item",
      type: "hasMany",
      foreignKey: "session_id",
      showInDetail: true,
      detailTab: "Line Items",
    },
  ],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "Show all packaging sessions this week",
    "What sessions are in progress?",
    "List completed sessions for January",
    "Show sessions with line items for brand X",
  ],

  keyFields: ["session_date", "status"],
};
