"use client";

import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { pricingTierEntity } from "@/entities/pricing-tier";

export default function NewPricingTierPage() {
  return (
    <EntityDetailPage
      entity={pricingTierEntity}
      basePath="/settings/pricing/tiers"
    />
  );
}
