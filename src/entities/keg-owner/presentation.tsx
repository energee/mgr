/**
 * Keg Owner Entity — presentation
 *
 * The React/UI half of the keg owner entity: list columns, list filters, the
 * unified detail/edit sections, and the deposits relation editor component.
 */

import type { EntityPresentation } from "@/types/entity";
import { deleteAction } from "@/types/entity";
import { KegOwnerDepositsEditor } from "@/components/domain/inventory/keg-owner-deposits-editor";
import type { KegOwner } from "./core";

/** Relation-tab wrapper for the per-owner deposits editor. */
function KegOwnerDepositsRelation({ parentId }: { parentId: string }) {
  return <KegOwnerDepositsEditor kegOwnerId={parentId} />;
}

export const kegOwnerPresentation: EntityPresentation<KegOwner> = {
  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "name",
      header: "Name",
      sortable: true,
    },
    {
      accessorKey: "code",
      header: "Code",
      sortable: true,
    },
    {
      accessorKey: "contact_name",
      header: "Contact",
      sortable: true,
      render: (value: unknown) => (value ? String(value) : "—"),
    },
    {
      accessorKey: "contact_email",
      header: "Email",
      sortable: false,
      render: (value: unknown) => (value ? String(value) : "—"),
    },
    {
      accessorKey: "is_active",
      header: "Active",
      sortable: true,
      render: (value: unknown) => (value ? "Yes" : "No"),
    },
  ],

  listFilters: [
    {
      field: "is_active",
      type: "select",
      label: "Status",
      options: [
        { value: "true", label: "Active" },
        { value: "false", label: "Inactive" },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Unified Sections (for EntityDetailUnified)
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "overview",
      title: "Owner Details",
      fields: [
        {
          name: "name",
          label: "Name",
          type: "text",
          placeholder: "e.g., Microstar",
          required: true,
          colSpan: 6,
        },
        {
          name: "code",
          label: "Code",
          type: "text",
          placeholder: "e.g., microstar",
          required: true,
          description: "Lowercase identifier (letters, numbers, hyphens, underscores)",
          colSpan: 6,
        },
        {
          name: "is_active",
          label: "Active",
          type: "switch",
          colSpan: 6,
        },
        {
          name: "position",
          label: "Display Order",
          type: "number",
          placeholder: "1",
          colSpan: 6,
        },
      ],
    },
    {
      id: "contact",
      title: "Contact Information",
      fields: [
        {
          name: "contact_name",
          label: "Contact Name",
          type: "text",
          colSpan: 4,
        },
        {
          name: "contact_email",
          label: "Contact Email",
          type: "text",
          placeholder: "email@example.com",
          colSpan: 4,
        },
        {
          name: "contact_phone",
          label: "Contact Phone",
          type: "text",
          colSpan: 4,
        },
      ],
    },
    {
      id: "notes",
      title: "Notes",
      fields: [
        {
          name: "notes",
          label: "Notes",
          type: "textarea",
          placeholder: "Optional notes about this fleet provider",
          colSpan: 12,
        },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: [deleteAction("Keg Owner")],

  // ---------------------------------------------------------------------------
  // Relation components — woven onto `core.relations` by createEntityConfig()
  // ---------------------------------------------------------------------------
  relationComponents: {
    deposits: KegOwnerDepositsRelation,
  },
};
