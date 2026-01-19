"use client";

import { use } from "react";
import { EntityForm } from "@/components/universal/entity-form";
import { kegTypeEntity } from "@/entities/keg-type";

export default function EditKegTypePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityForm entity={kegTypeEntity} id={id} basePath="/settings/keg-types" />;
}
