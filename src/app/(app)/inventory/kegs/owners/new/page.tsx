"use client";

import { EntityForm } from "@/components/universal/entity-form";
import { kegOwnerEntity } from "@/entities/keg-owner";

export default function NewKegOwnerPage() {
  return (
    <EntityForm entity={kegOwnerEntity} basePath="/inventory/kegs/owners" />
  );
}
