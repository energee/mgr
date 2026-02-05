"use client";

import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { pricingTierEntity } from "@/entities/pricing-tier";

export default function NewPricingTierPage() {
  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={pricingTierEntity}
      basePath="/settings/pricing/tiers"
    />
  );
}
