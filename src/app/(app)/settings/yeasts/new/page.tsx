"use client";

import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { yeastStrainEntity } from "@/entities/yeast-strain";

export default function NewYeastStrainPage() {
  return (
    <EntityDetailPage
      entity={yeastStrainEntity}
      basePath="/settings/yeasts"
    />
  );
}
