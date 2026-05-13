"use client";

import { use } from "react";
import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { beerStyleEntity } from "@/entities/beer-style";

export default function BeerStyleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetailPage entity={beerStyleEntity} id={id} basePath="/settings/beer-styles" />;
}
