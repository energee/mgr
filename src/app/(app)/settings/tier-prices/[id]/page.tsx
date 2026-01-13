"use client";

import { EntityDetail } from "@/components/universal/entity-detail";
import { tierPriceEntity } from "@/entities/tier-price";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function TierPriceDetailPage({ params }: Props) {
  const { id } = await params;
  return <EntityDetail entity={tierPriceEntity} id={id} basePath="/settings/tier-prices" />;
}
