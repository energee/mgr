"use client";

import { use } from "react";
import { EntityForm } from "@/components/universal/entity-form";
import { brandEntity } from "@/entities/brand";

export default function EditBrandPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityForm entity={brandEntity} id={id} basePath="/settings/brands" />;
}
