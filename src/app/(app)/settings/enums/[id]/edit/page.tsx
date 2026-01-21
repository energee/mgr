"use client";

import { use } from "react";
import { EntityForm } from "@/components/universal/entity-form";
import { enumValueEntity } from "@/entities/enum-value";

export default function EditEnumValuePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityForm entity={enumValueEntity} id={id} basePath="/settings/enums" />;
}
