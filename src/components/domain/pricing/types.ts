/**
 * Pricing Domain Types
 *
 * Shared row/view types for the pricing matrix feature
 * (settings/pricing page and its extracted components).
 */

export type SalesChannel = {
  id: string;
  name: string;
  code: string;
  position: number;
  is_active: boolean;
}

export type PricingTier = {
  id: string;
  name: string;
  cogs_max: number | null;
}

/** A selling format with container info, from the packaging_formats view */
export type SellingFormatWithContainer = {
  id: string;
  name: string;
  container_id: string;
  container_name: string;
  container_type: string;
  unit_count: number;
  volume_oz: number | null;
  volume_bbl: number | null;
}

export type PricingTierPrice = {
  id: string;
  pricing_tier_id: string;
  format_id: string;
  sales_channel_id: string;
  price: number;
}

export type ChannelFormat = {
  id: string;
  selling_format_id: string;
  sales_channel_id: string;
}

/** Formats grouped by container, in display order */
export type FormatGroup = {
  containerName: string;
  containerType: string;
  formats: SellingFormatWithContainer[];
}

/** Direction for keyboard navigation between matrix cells */
export type NavigateDirection = "up" | "down" | "left" | "right";
