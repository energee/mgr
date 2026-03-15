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
import { StatusBadge } from "@/components/universal/status-badge";
import { SessionLineItemsDisplay } from "@/components/domain/session-line-items-display";

type PackagingSessionTable = Database["public"]["Tables"]["packaging_sessions"]["Row"];

// Combined type: base table + computed fields from view
type PackagingSession = PackagingSessionTable & {
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
  viewTable: "packaging_sessions_with_summary",
  displayName: "Packaging Session",
  displayNamePlural: "Packaging Sessions",
  description: "Track kegging, canning, and bottling runs",
  domain: "production",

  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "session_date",
      header: "Date",
      sortable: true,
      format: "date",
    },
    {
      accessorKey: "status",
      header: "Status",
      sortable: true,
      render: (value) => (
        <StatusBadge
          status={value as string}
          config={packagingSessionEntity.stateMachine?.stateDisplay}
        />
      ),
    },
    {
      accessorKey: "brands",
      header: "Brands",
      render: (value) => value ? String(value) : "—",
    },
    {
      accessorKey: "total_planned",
      header: "Planned",
      sortable: true,
      render: (value) => (value && Number(value) > 0) ? String(value) : "—",
    },
    {
      accessorKey: "total_actual",
      header: "Actual",
      sortable: true,
      render: (value) => (value && Number(value) > 0) ? String(value) : "—",
    },
    {
      accessorKey: "total_variance",
      header: "Variance",
      sortable: true,
      render: (value, row) => {
        const v = value as number | null;
        const status = (row as PackagingSession).status;
        if (status !== "completed" && status !== "revised") return "—";
        if (v === null || v === undefined) return "—";
        const color = v === 0 ? "text-green-600" : v < 0 ? "text-red-600" : "text-green-600";
        return <span className={color}>{v > 0 ? `+${v}` : v}</span>;
      },
    },
    {
      accessorKey: "line_count",
      header: "Items",
      sortable: true,
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
  searchableFields: ["notes", "brands"],

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

  // ---------------------------------------------------------------------------
  // Unified Sections (for EntityDetailUnified)
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "overview",
      title: "Session Details",
      fields: [
        {
          name: "id",
          label: "Session ID",
          editable: false,
          colSpan: 6,
        },
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
          name: "created_at",
          label: "Created",
          format: "datetime",
          editable: false,
          colSpan: 6,
        },
        {
          name: "updated_at",
          label: "Last Updated",
          format: "datetime",
          editable: false,
          colSpan: 6,
        },
        {
          name: "completed_at",
          label: "Completed",
          format: "datetime",
          editable: false,
          colSpan: 6,
        },
      ],
    },
    {
      id: "notes",
      title: "Notes",
      collapsible: true,
      fields: [
        {
          name: "notes",
          label: "Notes",
          type: "textarea",
          placeholder: "Session notes, special instructions, etc.",
          fullWidth: true,
          colSpan: 12,
        },
      ],
    },
    {
      id: "line_items",
      title: "Line Items",
      component: SessionLineItemsDisplay,
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: packagingSessionSchema,

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------
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
