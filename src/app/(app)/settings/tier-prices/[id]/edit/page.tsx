"use client";

import { EntityForm } from "@/components/universal/entity-form";
import { tierPriceEntity } from "@/entities/tier-price";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditTierPricePage({ params }: Props) {
  const { id } = await params;
  return <EntityForm entity={tierPriceEntity} id={id} basePath="/settings/tier-prices" />;
}
