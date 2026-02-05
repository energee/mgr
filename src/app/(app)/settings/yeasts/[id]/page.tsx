"use client";

import { use } from "react";
import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { yeastStrainEntity } from "@/entities/yeast-strain";

export default function YeastStrainDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetailUnifiedWithErrorBoundary entity={yeastStrainEntity} id={id} basePath="/settings/yeasts" />;
}
