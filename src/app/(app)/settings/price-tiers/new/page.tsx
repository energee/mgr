"use client";

import { EntityForm } from "@/components/universal/entity-form";
import { priceTierEntity } from "@/entities/price-tier";

export default function NewPriceTierPage() {
  return <EntityForm entity={priceTierEntity} basePath="/settings/price-tiers" />;
}
