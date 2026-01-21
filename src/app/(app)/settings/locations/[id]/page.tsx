"use client";

import { use } from "react";
import { EntityDetail } from "@/components/universal/entity-detail";
import { locationEntity } from "@/entities/location";

export default function LocationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetail entity={locationEntity} id={id} basePath="/settings/locations" />;
}
