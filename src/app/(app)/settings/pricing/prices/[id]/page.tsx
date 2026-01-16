"use client";

import { use } from "react";
import { EntityDetail } from "@/components/universal/entity-detail";
import { tierPriceEntity } from "@/entities/tier-price";

export default function TierPriceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetail entity={tierPriceEntity} id={id} basePath="/settings/pricing/prices" />;
}
