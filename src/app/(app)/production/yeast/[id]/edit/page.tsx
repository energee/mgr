"use client";

import { EntityForm } from "@/components/universal/entity-form";
import { yeastPitchEntity } from "@/entities/yeast-pitch";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditYeastPitchPage({ params }: Props) {
  const { id } = await params;
  return <EntityForm entity={yeastPitchEntity} id={id} basePath="/production/yeast" />;
}
