"use client";

import { use } from "react";
import { EntityForm } from "@/components/universal/entity-form";
import { binEntity } from "@/entities/bin";

export default function EditBinPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityForm entity={binEntity} id={id} basePath="/inventory/bins" />;
}
