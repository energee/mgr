"use client";

import { use } from "react";
import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { beerStyleEntity } from "@/entities/beer-style";

export default function BeerStyleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetailUnifiedWithErrorBoundary entity={beerStyleEntity} id={id} basePath="/settings/beer-styles" />;
}
