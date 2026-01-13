"use client";

import { EntityDetail } from "@/components/universal/entity-detail";
import { priceTierEntity } from "@/entities/price-tier";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function PriceTierDetailPage({ params }: Props) {
  const { id } = await params;
  return <EntityDetail entity={priceTierEntity} id={id} basePath="/settings/price-tiers" />;
}
