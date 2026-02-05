"use client";

import { EntityForm } from "@/components/universal/entity-form";
import { pricingTierEntity } from "@/entities/pricing-tier";

export default function NewPricingTierPage() {
  return <EntityForm entity={pricingTierEntity} basePath="/settings/pricing/tiers" />;
}
