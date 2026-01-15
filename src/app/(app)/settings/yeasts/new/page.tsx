"use client";

import { EntityForm } from "@/components/universal/entity-form";
import { yeastStrainEntity } from "@/entities/yeast-strain";

export default function NewYeastStrainPage() {
  return <EntityForm entity={yeastStrainEntity} basePath="/settings/yeasts" />;
}
