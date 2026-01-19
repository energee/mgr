"use client";

import { EntityForm } from "@/components/universal/entity-form";
import { kegTypeEntity } from "@/entities/keg-type";

export default function NewKegTypePage() {
  return <EntityForm entity={kegTypeEntity} basePath="/settings/keg-types" />;
}
