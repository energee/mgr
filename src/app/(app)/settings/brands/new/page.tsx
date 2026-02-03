"use client";

import { EntityForm } from "@/components/universal/entity-form";
import { brandEntity } from "@/entities/brand";

export default function NewBrandPage() {
  return <EntityForm entity={brandEntity} basePath="/settings/brands" />;
}
