/**
 * Brand Entity Configuration
 *
 * Brands represent the brewery's beer products/labels.
 * Each brand has a style, ABV, and optional Untappd integration.
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";
import type { Database } from "@/types/supabase";

type Brand = Database["public"]["Tables"]["brands"]["Row"];

// =============================================================================
// Zod Schema
// =============================================================================

export const brandSchema = z.object({
  name: z.string().min(1, "Name is required"),
  variant: z.string().nullable().optional(),
  style_id: z.string().uuid().nullable().optional(),
  abv: z.coerce.number().nullable().optional(),
  description: z.string().nullable().optional(),
  untappd_url: z.string().url().nullable().optional().or(z.literal("")),
});

export type BrandFormValues = z.infer<typeof brandSchema>;

// =============================================================================
// Entity Configuration
// =============================================================================

export const brandEntity: EntityConfig<Brand> = {
  // ---------------------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------------------
  name: "brand",
  table: "brands",
  displayName: "Brand",
  displayNamePlural: "Brands",
  description: "Beer brands and products",
  domain: "production",
  basePath: "/settings/brands",

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
      accessorKey: "variant",
      header: "Variant",
      sortable: true,
    },
    {
      accessorKey: "style_id",
      header: "Style",
      sortable: true,
      relation: {
        entity: "beer_style",
        displayField: "name",
      },
    },
    {
      accessorKey: "abv",
      header: "ABV",
      sortable: true,
      render: (value) => (value ? `${value}%` : "—"),
    },
  ],

  listFilters: [
    {
      field: "style_id",
      type: "select",
      label: "Style",
      dynamicOptions: {
        table: "beer_styles",
        valueField: "id",
        labelField: "name",
        orderBy: "name",
      },
    },
  ],

  defaultSort: { column: "name", direction: "asc" },
  searchableFields: ["name", "variant", "description"],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "name",
    subtitle: "variant",
  },

  // ---------------------------------------------------------------------------
  // Unified Sections (detail + edit)
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "overview",
      title: "Brand Information",
      fields: [
        {
          name: "name",
          label: "Name",
          type: "text",
          placeholder: "e.g., Hop Highway",
          required: true,
          colSpan: 6,
        },
        {
          name: "variant",
          label: "Variant",
          type: "text",
          placeholder: "e.g., Session, Double, Nitro",
          colSpan: 6,
        },
        {
          name: "style_id",
          label: "Style",
          type: "relation",
          relation: {
            entity: "beer_style",
            displayField: "name",
          },
          colSpan: 6,
        },
        {
          name: "abv",
          label: "ABV",
          type: "number",
          placeholder: "e.g., 6.5",
          render: (v) => (v ? `${v}%` : "—"),
          colSpan: 6,
        },
      ],
    },
    {
      id: "description",
      title: "Description",
      fields: [
        {
          name: "description",
          label: "Description",
          type: "textarea",
          placeholder: "Beer description, tasting notes, etc.",
          fullWidth: true,
        },
      ],
    },
    {
      id: "untappd",
      title: "Untappd",
      collapsible: true,
      fields: [
        {
          name: "untappd_url",
          label: "Untappd URL",
          type: "text",
          placeholder: "https://untappd.com/b/...",
          colSpan: 6,
        },
        {
          name: "untappd_rating",
          label: "Rating",
          editable: false,
          colSpan: 6,
        },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: brandSchema,

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------
  relations: [
    {
      name: "style",
      entity: "beer_style",
      type: "belongsTo",
      foreignKey: "style_id",
    },
  ],
};
