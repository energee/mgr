"use client";

import { use } from "react";
import { EntityDetail } from "@/components/universal/entity-detail";
import { yeastStrainEntity } from "@/entities/yeast-strain";

export default function YeastStrainDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetail entity={yeastStrainEntity} id={id} basePath="/settings/yeasts" />;
}
