"use client";

import { use } from "react";
import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { yeastStrainEntity } from "@/entities/yeast-strain";

export default function YeastStrainDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetailPage entity={yeastStrainEntity} id={id} basePath="/settings/yeasts" />;
}
