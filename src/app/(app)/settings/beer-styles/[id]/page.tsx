"use client";

import { use } from "react";
import { EntityDetail } from "@/components/universal/entity-detail";
import { beerStyleEntity } from "@/entities/beer-style";

export default function BeerStyleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  return (
    <EntityDetail
      entity={beerStyleEntity}
      id={id}
      basePath="/settings/beer-styles"
    />
  );
}
