"use client";

import { use } from "react";
import { EntityDetail } from "@/components/universal/entity-detail";
import { kegTypeEntity } from "@/entities/keg-type";

export default function KegTypeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetail entity={kegTypeEntity} id={id} basePath="/settings/keg-types" />;
}
