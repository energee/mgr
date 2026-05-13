"use client";

import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { brandEntity } from "@/entities/brand";

export default function NewBrandPage() {
  return (
    <EntityDetailPage
      entity={brandEntity}
      basePath="/settings/brands"
    />
  );
}
