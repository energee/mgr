"use client";

import { EntityList } from "@/components/universal/entity-list";
import { tierPriceEntity } from "@/entities/tier-price";

export default function TierPricesPage() {
  return <EntityList entity={tierPriceEntity} basePath="/settings/tier-prices" />;
}
