"use client";

import { use } from "react";
import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { pricingTierEntity } from "@/entities/pricing-tier";

export default function PricingTierDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetailPage entity={pricingTierEntity} id={id} basePath="/settings/pricing/tiers" />;
}
