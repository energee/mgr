"use client";

import { use } from "react";
import { EntityForm } from "@/components/universal/entity-form";
import { locationEntity } from "@/entities/location";

export default function EditLocationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityForm entity={locationEntity} id={id} basePath="/settings/locations" />;
}
