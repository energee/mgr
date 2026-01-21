"use client";

import { EntityForm } from "@/components/universal/entity-form";
import { enumValueEntity } from "@/entities/enum-value";

export default function NewEnumValuePage() {
  return <EntityForm entity={enumValueEntity} basePath="/settings/enums" />;
}
