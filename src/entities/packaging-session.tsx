/**
 * Packaging Session Entity Configuration
 *
 * Packaging sessions track kegging, canning, and bottling runs.
 * Each session can contain multiple line items (products from different batches).
 *
 * Lifecycle: planned → in_progress → completed → revised | cancelled
 *
 * Note: "revised" and "cancelled" are terminal states. "Revised" indicates
 * the session was completed but later adjusted (quantity corrections).
 * Historical record is preserved; to re-run packaging, create a new session.
 *
 * completed → revised is gated by stateMachine.requiresAction: it can only
 * happen through the "revise" action, which the detail page intercepts to
 * open RevisePackagingSession (quantity edits + finished-goods/material
 * deltas via the revise_packaging_session RPC, migration 00184). A DB
 * trigger blocks bare status UPDATEs into "revised" as the backstop, so
 * surfaces without the dialog (e.g. the list row menu) fail with guidance
 * instead of silently flipping the label.
 */

import { z } from "zod";
import type { EntityConfig, StateMachineConfig } from "@/types/entity";
import { statesAsOptions } from "@/types/entity";
import type { Database } from "@/types/supabase";
import { StatusBadge } from "@/components/universal/status-badge";
import { SessionLineItemsDisplay } from "@/components/domain/packaging/session-line-items-display";
import { PackagingSessionMaterialsSection } from "@/components/domain/packaging/packaging-session-materials";

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
  // Reaching "revised" requires the interactive revise flow (quantity edits +
  // finished-goods/material adjustments) — suppresses the generic "Move to
  // Revised" item and the bulk-bar option in favor of the "revise" action.
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
  basePath: "/production/packaging",

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
      header: "Var %",
      sortable: true,
      render: (_value, row) => {
        const session = row as PackagingSession;
        if (session.status !== "completed" && session.status !== "revised") return "—";
        const planned = session.total_planned;
        if (!planned || planned === 0) return "—";
        const pct = ((session.total_actual ?? 0) - planned) / planned * 100;
        const color = Math.abs(pct) <= 5 ? "text-green-600" : "text-red-600";
        return <span className={color}>{pct >= 0 ? "+" : ""}{pct.toFixed(1)}%</span>;
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
          // Defaults to today on create. Only the generic /production/packaging/new
          // form needs this — the domain dialogs (packaging-batch-dialog,
          // add-to-packaging-session-dialog) already set today themselves.
          name: "session_date",
          label: "Session Date",
          type: "date",
          required: true,
          defaultValue: () => new Date().toISOString().split("T")[0],
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
    {
      id: "materials",
      title: "Materials Required",
      component: PackagingSessionMaterialsSection,
      collapsible: true,
    },
  ],

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: [
    {
      // Paired with stateMachine.requiresAction.revised. The detail page
      // ([id]/page.tsx) intercepts this via onAction and opens
      // RevisePackagingSession; the actual status flip happens inside the
      // revise_packaging_session RPC. toState is declared so the
      // requiresAction contract holds (see requires-action.test.ts) — a
      // surface that dispatches the bare transition instead (list row menu)
      // is refused by the DB trigger guard with a pointer to this flow.
      name: "revise",
      label: "Revise Quantities",
      icon: "pencil",
      type: "button",
      fromStates: ["completed", "revised"],
      toState: "revised",
    },
    {
      // Navigation-only: jumps to the keg-transaction create page with the
      // fill type and this session prefilled (EntityDetailPage merges these
      // searchParams into create defaults; from/to keg states derive from
      // transaction_type at the schema level). Links the fill transactions
      // back to the session that produced them.
      name: "record_keg_fills",
      label: "Record Keg Fills",
      icon: "external-link",
      type: "dropdown",
      fromStates: ["completed", "revised"],
      handler: (session) => {
        // Entity configs run outside React, so there is no client router here.
        window.location.assign(
          `/inventory/kegs/transactions/new?transaction_type=fill&packaging_session_id=${session.id}`
        );
      },
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
};
