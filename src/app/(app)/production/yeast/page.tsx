"use client";

import { EntityList } from "@/components/universal/entity-list";
import { yeastPitchEntity } from "@/entities/yeast-pitch";

export default function YeastPitchesPage() {
  return <EntityList entity={yeastPitchEntity} basePath="/production/yeast" />;
}
