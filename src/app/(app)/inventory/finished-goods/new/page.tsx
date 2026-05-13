"use client";

import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { finishedGoodEntity } from "@/entities/finished-good";

export default function NewFinishedGoodPage() {
  return <EntityDetailPage entity={finishedGoodEntity} basePath="/inventory/finished-goods" />;
}
