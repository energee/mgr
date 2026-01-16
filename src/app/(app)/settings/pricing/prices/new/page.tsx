"use client";

import { EntityForm } from "@/components/universal/entity-form";
import { tierPriceEntity } from "@/entities/tier-price";

export default function NewTierPricePage() {
  return <EntityForm entity={tierPriceEntity} basePath="/settings/pricing/prices" />;
}
