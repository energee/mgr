"use client";

import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { beerStyleEntity } from "@/entities/beer-style";

export default function NewBeerStylePage() {
  return (
    <EntityDetailPage
      entity={beerStyleEntity}
      basePath="/settings/beer-styles"
    />
  );
}
