"use client";

import { EntityDetail } from "@/components/universal/entity-detail";
import { yeastPitchEntity } from "@/entities/yeast-pitch";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function YeastPitchDetailPage({ params }: Props) {
  const { id } = await params;
  return <EntityDetail entity={yeastPitchEntity} id={id} basePath="/production/yeast" />;
}
