/**
 * Packaging Session Entity — presentation
 *
 * The React/UI half of the packaging session entity: list columns, list
 * filters, and the unified detail/edit sections (including section-level
 * components for line items and materials).
 */

import type { EntityPresentation } from "@/types/entity";
import { StatusBadge } from "@/components/universal/status-badge";
import { SessionLineItemsDisplay } from "@/components/domain/packaging/session-line-items-display";
import { PackagingSessionMaterialsSection } from "@/components/domain/packaging/packaging-session-materials";
import type { PackagingSession } from "./core";
import { packagingSessionStateMachine, statusOptions } from "./core";

export const packagingSessionPresentation: EntityPresentation<PackagingSession> = {
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
          config={packagingSessionStateMachine.stateDisplay}
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
          // Defaults to today on the generic create form.
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
      // intercepts this via onAction and opens RevisePackagingSession; the
      // status flip happens inside the revise_packaging_session RPC (00184).
      name: "revise",
      label: "Revise Quantities",
      icon: "pencil",
      type: "button",
      fromStates: ["completed", "revised"],
      toState: "revised",
    },
    {
      // Navigation-only: jumps to the keg-transaction create page with the
      // fill type and this session prefilled (searchParams merge into create
      // defaults), linking fill transactions back to their session.
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
};
