"use client";

/**
 * New Packaging Session Page
 */

import { EntityForm } from "@/components/universal/entity-form";
import { packagingSessionEntity } from "@/entities/packaging-session";

export default function NewPackagingSessionPage() {
  return (
    <EntityForm
      entity={packagingSessionEntity}
      basePath="/production/packaging"
    />
  );
}
