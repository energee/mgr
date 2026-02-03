"use client";

import { use } from "react";
import { EntityForm } from "@/components/universal/entity-form";
import { beerStyleEntity } from "@/entities/beer-style";

export default function EditBeerStylePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityForm entity={beerStyleEntity} id={id} basePath="/settings/beer-styles" />;
}
