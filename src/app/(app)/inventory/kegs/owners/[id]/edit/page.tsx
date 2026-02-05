"use client";

import { use } from "react";
import { EntityForm } from "@/components/universal/entity-form";
import { kegOwnerEntity } from "@/entities/keg-owner";

export default function EditKegOwnerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <EntityForm
      entity={kegOwnerEntity}
      id={id}
      basePath="/inventory/kegs/owners"
    />
  );
}
