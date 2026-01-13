"use client";

import { EntityForm } from "@/components/universal/entity-form";
import { yeastPitchEntity } from "@/entities/yeast-pitch";

export default function NewYeastPitchPage() {
  return <EntityForm entity={yeastPitchEntity} basePath="/production/yeast" />;
}
