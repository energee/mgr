"use client";

import { EntityForm } from "@/components/universal/entity-form";
import { priceTierEntity } from "@/entities/price-tier";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditPriceTierPage({ params }: Props) {
  const { id } = await params;
  return <EntityForm entity={priceTierEntity} id={id} basePath="/settings/price-tiers" />;
}
