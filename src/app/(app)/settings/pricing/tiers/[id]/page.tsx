"use client";

import { use } from "react";
import { EntityDetail } from "@/components/universal/entity-detail";
import { priceTierEntity } from "@/entities/price-tier";

export default function PriceTierDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetail entity={priceTierEntity} id={id} basePath="/settings/pricing/tiers" />;
}
