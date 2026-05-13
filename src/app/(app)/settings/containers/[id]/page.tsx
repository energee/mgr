"use client";

/**
 * Container Detail Page
 *
 * View/edit a container and its selling formats (shown as a child relation).
 */

import { use } from "react";
import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { containerEntity } from "@/entities/container";

export default function ContainerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <EntityDetailPage
      entity={containerEntity}
      id={id}
      basePath="/settings/containers"
    />
  );
}
