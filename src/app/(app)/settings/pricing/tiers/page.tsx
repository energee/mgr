"use client";

import { EntityList } from "@/components/universal/entity-list";
import { pricingTierEntity } from "@/entities/pricing-tier";

export default function PricingTiersPage() {
  return (
    <EntityList
      entity={pricingTierEntity}
      basePath="/settings/pricing/tiers"
    />
  );
}
