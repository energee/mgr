"use client";

import { use } from "react";
import { EntityForm } from "@/components/universal/entity-form";
import { pricingTierEntity } from "@/entities/pricing-tier";

export default function EditPricingTierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityForm entity={pricingTierEntity} id={id} basePath="/settings/pricing/tiers" />;
}
