"use client";

import { use } from "react";
import { EntityForm } from "@/components/universal/entity-form";
import { yeastStrainEntity } from "@/entities/yeast-strain";

export default function EditYeastStrainPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityForm entity={yeastStrainEntity} id={id} basePath="/settings/yeasts" />;
}
