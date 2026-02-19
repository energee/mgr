/**
 * Keg Type Entity Configuration
 *
 * Keg types define the physical keg sizes used for packaging and tracking.
 * Each type has a volume (in BBL for TTB reporting) and an optional deposit amount.
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";
import type { Database } from "@/types/supabase";

type KegType = Database["public"]["Tables"]["keg_types"]["Row"];

// =============================================================================
// Zod Schema
// =============================================================================

export const kegTypeSchema = z.object({
  name: z.string().min(1, "Name is required"),
  code: z.string().min(1, "Code is required"),
  volume_bbl: z.coerce.number().positive("Volume must be positive"),
  deposit_amount: z.coerce.number().min(0, "Deposit cannot be negative").default(0),
  description: z.string().nullable().optional(),
  show_in_pricing: z.boolean().default(false),
  is_active: z.boolean().default(true),
  position: z.coerce.number().int().nullable().optional(),
});

export type KegTypeFormValues = z.infer<typeof kegTypeSchema>;

// =============================================================================
// Entity Configuration
// =============================================================================

export const kegTypeEntity: EntityConfig<KegType> = {
  // ---------------------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------------------
  name: "keg_type",
  table: "keg_types",
  displayName: "Keg Type",
  displayNamePlural: "Keg Types",
  description: "Keg size definitions for inventory tracking and deposit management",
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
      accessorKey: "volume_bbl",
      header: "Volume (BBL)",
      sortable: true,
      format: "unit",
      unitType: "volume",
    },
    {
      accessorKey: "deposit_amount",
      header: "Deposit",
      sortable: true,
      format: "currency",
    },
    {
      accessorKey: "is_active",
      header: "Active",
      sortable: true,
      render: (value) => (value ? "Yes" : "No"),
    },
    {
      accessorKey: "show_in_pricing",
      header: "In Pricing",
      sortable: true,
      render: (value) => (value ? "Yes" : "—"),
    },
  ],

  listFilters: [
    {
      field: "is_active",
      type: "boolean",
      label: "Active",
    },
  ],

  defaultSort: { column: "name", direction: "asc" },
  searchableFields: ["name", "code"],

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
      title: "Keg Type Details",
      fields: [
        { field: "name", label: "Name" },
        { field: "code", label: "Code" },
        { field: "volume_bbl", label: "Volume", format: "unit", unitType: "volume" },
        { field: "deposit_amount", label: "Deposit", format: "currency" },
        { field: "description", label: "Description" },
        { field: "is_active", label: "Active" },
        { field: "show_in_pricing", label: "Show in Pricing" },
        { field: "created_at", label: "Created", format: "datetime" },
        { field: "updated_at", label: "Last Updated", format: "datetime" },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Unified Sections (detail + edit)
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "overview",
      title: "Keg Type Details",
      fields: [
        {
          name: "name",
          label: "Name",
          type: "text",
          placeholder: "e.g., 1/2 Barrel, 1/6 Barrel, 50 Liter",
          required: true,
          colSpan: 6,
        },
        {
          name: "code",
          label: "Code",
          type: "text",
          placeholder: "e.g., half, sixth, 50L",
          required: true,
          description: "Short code for identification",
          colSpan: 6,
        },
        {
          name: "volume_bbl",
          label: "Volume",
          type: "unit",
          unitType: "volume",
          format: "unit",
          placeholder: "e.g., 0.5, 0.1667",
          required: true,
          description: "Volume in barrels for TTB reporting",
          colSpan: 6,
        },
        {
          name: "deposit_amount",
          label: "Deposit",
          type: "number",
          format: "currency",
          placeholder: "e.g., 30.00",
          description: "Keg deposit charged to customers",
          colSpan: 6,
        },
        {
          name: "description",
          label: "Description",
          type: "textarea",
          placeholder: "Optional notes about this keg type",
          colSpan: 12,
        },
        {
          name: "show_in_pricing",
          label: "Show in Pricing",
          type: "switch",
          description: "Include this keg type in the pricing matrix",
          colSpan: 6,
        },
        {
          name: "is_active",
          label: "Active",
          type: "switch",
          description: "Inactive types won't appear in dropdown menus",
          defaultValue: true,
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
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: kegTypeSchema,

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: [
    {
      name: "delete",
      label: "Delete Keg Type",
      icon: "trash",
      type: "dropdown",
      variant: "destructive",
      deleteMode: "hard",
    },
  ],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "List all keg types",
    "What is the deposit for a 1/2 barrel?",
    "Show keg sizes by volume",
  ],

  keyFields: ["name", "code", "volume_bbl", "deposit_amount", "is_active"],
};
