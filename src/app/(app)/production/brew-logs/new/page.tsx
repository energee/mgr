"use client";

import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { brewLogEntity } from "@/entities/brew-log";

export default function NewBrewLogPage() {
  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={brewLogEntity}
      basePath="/production/brew-logs"
    />
  );
}
