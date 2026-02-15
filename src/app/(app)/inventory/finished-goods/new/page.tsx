"use client";

import { EntityDetailUnified } from "@/components/universal/entity-detail-unified";
import { finishedGoodEntity } from "@/entities/finished-good";

export default function NewFinishedGoodPage() {
  return <EntityDetailUnified entity={finishedGoodEntity} basePath="/inventory/finished-goods" />;
}
