"use client";

import { EntityForm } from "@/components/universal/entity-form";
import { finishedGoodEntity } from "@/entities/finished-good";

export default function NewFinishedGoodPage() {
  return <EntityForm entity={finishedGoodEntity} basePath="/inventory/finished-goods" />;
}
