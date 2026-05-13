"use client";

import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { locationEntity } from "@/entities/location";

export default function NewLocationPage() {
  return (
    <EntityDetailPage
      entity={locationEntity}
      basePath="/settings/locations"
    />
  );
}
