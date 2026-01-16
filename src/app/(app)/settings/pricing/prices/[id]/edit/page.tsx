"use client";

import { use } from "react";
import { EntityForm } from "@/components/universal/entity-form";
import { tierPriceEntity } from "@/entities/tier-price";

export default function EditTierPricePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityForm entity={tierPriceEntity} id={id} basePath="/settings/pricing/prices" />;
}
