"use client";

import { use } from "react";
import { EntityDetail } from "@/components/universal/entity-detail";
import { packageTypeEntity } from "@/entities/package-type";

export default function PackageTypeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetail entity={packageTypeEntity} id={id} basePath="/settings/formats" />;
}
