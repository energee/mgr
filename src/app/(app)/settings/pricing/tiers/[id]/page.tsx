"use client";

import { use } from "react";
import { EntityDetail } from "@/components/universal/entity-detail";
import { pricingTierEntity } from "@/entities/pricing-tier";

export default function PricingTierDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetail entity={pricingTierEntity} id={id} basePath="/settings/pricing/tiers" />;
}
