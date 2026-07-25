/**
 * Pricing Tier Price Entity — presentation
 *
 * The React/UI half of the pricing tier price entity: list columns and the
 * unified detail/edit sections.
 */

import type { EntityPresentation } from "@/types/entity";
import type { PricingTierPrice } from "./core";

export const pricingTierPricePresentation: EntityPresentation<PricingTierPrice> = {
  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "pricing_tier_id",
      header: "Tier",
      relation: {
        entity: "pricing_tier",
        displayField: "name",
      },
    },
    {
      accessorKey: "format_id",
      header: "Format",
      relation: {
        entity: "selling_format",
        displayField: "name",
      },
    },
    {
      accessorKey: "sales_channel_id",
      header: "Channel",
      relation: {
        entity: "sales_channel",
        displayField: "name",
      },
    },
    {
      accessorKey: "price",
      header: "Price",
      render: (value) => (value != null ? `$${Number(value).toFixed(2)}` : "—"),
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
          name: "pricing_tier_id",
          label: "Pricing Tier",
          type: "select",
          placeholder: "Select tier...",
          required: true,
          colSpan: 4,
          dynamicOptions: {
            table: "pricing_tiers",
            valueField: "id",
            labelField: "name",
            orderBy: "cogs_max",
          },
        },
        {
          name: "format_id",
          label: "Selling Format",
          type: "relation",
          placeholder: "Select format...",
          required: true,
          colSpan: 4,
          relation: { entity: "selling_format", displayField: "name" },
        },
        {
          name: "sales_channel_id",
          label: "Sales Channel",
          type: "select",
          placeholder: "Select channel...",
          required: true,
          colSpan: 4,
          dynamicOptions: {
            table: "sales_channels",
            valueField: "id",
            labelField: "name",
            orderBy: "position",
            filter: { is_active: true },
          },
        },
        {
          name: "price",
          label: "Price",
          type: "number",
          format: "currency",
          placeholder: "e.g., 42.00",
          required: true,
          colSpan: 4,
        },
      ],
    },
  ],
};
