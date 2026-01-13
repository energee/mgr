"use client";

import { EntityList } from "@/components/universal/entity-list";
import { priceTierEntity } from "@/entities/price-tier";

export default function PriceTiersPage() {
  return <EntityList entity={priceTierEntity} basePath="/settings/price-tiers" />;
}
