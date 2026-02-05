"use client";

import { use } from "react";
import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { pricingTierEntity } from "@/entities/pricing-tier";

export default function PricingTierDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetailUnifiedWithErrorBoundary entity={pricingTierEntity} id={id} basePath="/settings/pricing/tiers" />;
}
