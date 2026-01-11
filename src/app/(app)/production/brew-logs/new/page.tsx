"use client";

/**
 * New Brew Log Page
 */

import { EntityForm } from "@/components/universal/entity-form";
import { brewLogEntity } from "@/entities/brew-log";

export default function NewBrewLogPage() {
  return (
    <EntityForm
      entity={brewLogEntity}
      basePath="/production/brew-logs"
    />
  );
}
