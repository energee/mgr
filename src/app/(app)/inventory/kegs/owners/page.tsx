"use client";

import { EntityList } from "@/components/universal/entity-list";
import { kegOwnerEntity } from "@/entities/keg-owner";

export default function KegOwnersPage() {
  return (
    <EntityList entity={kegOwnerEntity} basePath="/inventory/kegs/owners" />
  );
}
