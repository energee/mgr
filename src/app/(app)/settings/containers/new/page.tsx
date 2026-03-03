"use client";

/**
 * New Container Page
 *
 * Create a new container (can, bottle, keg).
 */

import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { containerEntity } from "@/entities/container";

export default function NewContainerPage() {
  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={containerEntity}
      basePath="/settings/containers"
    />
  );
}
