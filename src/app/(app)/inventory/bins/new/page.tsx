"use client";

import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { binEntity } from "@/entities/bin";

export default function NewBinPage() {
  return (
    <EntityDetailPage
      entity={binEntity}
      basePath="/inventory/bins"
    />
  );
}
