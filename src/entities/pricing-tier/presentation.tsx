/**
 * Pricing Tier Entity — presentation
 *
 * The React/UI half of the pricing tier entity: list columns and the unified
 * detail/edit sections. Pricing tiers have no delete action — they are
 * referenced by prices and recipes.
 */

import type { EntityPresentation } from "@/types/entity";
import type { PricingTier } from "./core";

export const pricingTierPresentation: EntityPresentation<PricingTier> = {
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
      accessorKey: "cogs_max",
      header: "COGS Upper Bound",
      sortable: true,
      render: (value) => (value != null ? `$${Number(value).toFixed(2)}` : "—"),
    },
    {
      accessorKey: "default_upc",
      header: "Default UPC",
      render: (value) => (value ? String(value) : "—"),
    },
  ],

  // ---------------------------------------------------------------------------
  // Unified Sections (detail + edit)
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "overview",
      title: "Overview",
      fields: [
        {
          name: "name",
          label: "Tier Name",
          type: "text",
          placeholder: 'e.g., "Tier 1" or "IPA"',
          required: true,
          colSpan: 6,
        },
        {
          name: "cogs_max",
          label: "COGS Upper Bound",
          type: "number",
          format: "currency",
          placeholder: "e.g., 8.00",
          description: "Recipes with COGS up to this value fall in this tier",
          colSpan: 6,
        },
        {
          name: "default_upc",
          label: "Default UPC",
          type: "text",
          placeholder: "e.g., 123456789012",
          description: "Overridden by brand UPC if set",
          colSpan: 12,
        },
      ],
    },
  ],
};
