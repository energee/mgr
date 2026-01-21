"use client";

import { EntityForm } from "@/components/universal/entity-form";
import { locationEntity } from "@/entities/location";

export default function NewLocationPage() {
  return <EntityForm entity={locationEntity} basePath="/settings/locations" />;
}
