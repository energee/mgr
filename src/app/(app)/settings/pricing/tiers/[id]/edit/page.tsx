"use client";

import { use } from "react";
import { EntityForm } from "@/components/universal/entity-form";
import { priceTierEntity } from "@/entities/price-tier";

export default function EditPriceTierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityForm entity={priceTierEntity} id={id} basePath="/settings/pricing/tiers" />;
}
