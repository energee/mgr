"use client";

import { EntityForm } from "@/components/universal/entity-form";
import { packageTypeEntity } from "@/entities/package-type";

export default function NewPackageTypePage() {
  return <EntityForm entity={packageTypeEntity} basePath="/settings/formats" />;
}
