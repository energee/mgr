/**
 * Keg Owner Entity Configuration
 *
 * Fleet provider definitions (Owned, Microstar, KegFleet, etc.).
 * Tracks who owns each keg for logistics, deposits, and return routing.
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";
import { KegOwnerDepositsEditor } from "@/components/domain/keg-owner-deposits-editor";

// =============================================================================
// Types
// =============================================================================

interface KegOwner {
  id: string;
  name: string;
  code: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
  is_active: boolean;
  position: number | null;
  created_at: string | null;
  updated_at: string | null;
}

// =============================================================================
// Zod Schema
// =============================================================================

export const kegOwnerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  code: z
    .string()
    .min(1, "Code is required")
    .regex(/^[a-z0-9_-]+$/, "Code must be lowercase alphanumeric with hyphens/underscores"),
  contact_name: z.string().nullable().optional(),
  contact_email: z.string().email("Invalid email").nullable().optional().or(z.literal("")),
  contact_phone: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
  position: z.coerce.number().int().nullable().optional(),
});

export type KegOwnerFormValues = z.infer<typeof kegOwnerSchema>;

// =============================================================================
// Relation wrapper for deposits editor
// =============================================================================

function KegOwnerDepositsRelation({ parentId }: { parentId: string }) {
  return <KegOwnerDepositsEditor kegOwnerId={parentId} />;
}

// =============================================================================
// Entity Configuration
// =============================================================================

export const kegOwnerEntity: EntityConfig<KegOwner> = {
  // ---------------------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------------------
  name: "keg_owner",
  table: "keg_owners",
  displayName: "Keg Owner",
  displayNamePlural: "Keg Owners",
  description: "Fleet providers that own kegs (e.g., Owned, Microstar, KegFleet)",
  domain: "inventory",

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

  defaultSort: { column: "position", direction: "asc" },
  searchableFields: ["name", "code", "contact_name"],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "name",
    subtitle: "code",
  },

  detailSections: [
    {
      id: "overview",
      title: "Owner Details",
      fields: [
        { field: "name", label: "Name" },
        { field: "code", label: "Code" },
        { field: "is_active", label: "Active" },
        { field: "position", label: "Display Order" },
      ],
    },
    {
      id: "contact",
      title: "Contact Information",
      fields: [
        { field: "contact_name", label: "Contact Name" },
        { field: "contact_email", label: "Email" },
        { field: "contact_phone", label: "Phone" },
      ],
    },
    {
      id: "notes",
      title: "Notes",
      fields: [{ field: "notes", label: "Notes" }],
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
  // Form
  // ---------------------------------------------------------------------------
  formSchema: kegOwnerSchema,

  formFields: [
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
    {
      name: "notes",
      label: "Notes",
      type: "textarea",
      placeholder: "Optional notes about this fleet provider",
      colSpan: 12,
    },
  ],

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: [
    {
      name: "delete",
      label: "Delete Keg Owner",
      icon: "trash",
      type: "dropdown",
      variant: "destructive",
      deleteMode: "hard" as const,
    },
  ],

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------
  relations: [
    {
      name: "deposits",
      entity: "keg_owner_deposit",
      type: "hasMany",
      foreignKey: "keg_owner_id",
      showInDetail: true,
      component: KegOwnerDepositsRelation,
    },
  ],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "List all keg owners",
    "Show active fleet providers",
    "Which fleet does Microstar provide?",
  ],

  keyFields: ["name", "code", "is_active"],
};
