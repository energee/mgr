"use client";

import { use } from "react";
import { EntityForm } from "@/components/universal/entity-form";
import { packageTypeEntity } from "@/entities/package-type";

export default function EditPackageTypePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityForm entity={packageTypeEntity} id={id} basePath="/settings/formats" />;
}
