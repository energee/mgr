"use client";

/**
 * New Container Page
 *
 * Create a new container (can, bottle, keg).
 */

import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { containerEntity } from "@/entities/container";

export default function NewContainerPage() {
  return (
    <EntityDetailPage
      entity={containerEntity}
      basePath="/settings/containers"
    />
  );
}
