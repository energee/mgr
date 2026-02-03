"use client";

import { EntityForm } from "@/components/universal/entity-form";
import { beerStyleEntity } from "@/entities/beer-style";

export default function NewBeerStylePage() {
  return <EntityForm entity={beerStyleEntity} basePath="/settings/beer-styles" />;
}
