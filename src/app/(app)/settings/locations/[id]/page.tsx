"use client";

import { use } from "react";
import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { locationEntity } from "@/entities/location";

export default function LocationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetailPage entity={locationEntity} id={id} basePath="/settings/locations" />;
}
