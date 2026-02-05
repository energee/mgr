"use client";

import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { beerStyleEntity } from "@/entities/beer-style";

export default function NewBeerStylePage() {
  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={beerStyleEntity}
      basePath="/settings/beer-styles"
    />
  );
}
