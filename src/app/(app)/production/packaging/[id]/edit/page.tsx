"use client";

/**
 * Edit Packaging Session Page
 */

import { use } from "react";
import { EntityForm } from "@/components/universal/entity-form";
import { packagingSessionEntity } from "@/entities/packaging-session";

export default function EditPackagingSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  return (
    <EntityForm
      entity={packagingSessionEntity}
      id={id}
      basePath="/production/packaging"
    />
  );
}
