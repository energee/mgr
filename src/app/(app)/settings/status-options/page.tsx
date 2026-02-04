"use client";

/**
 * Status & Options Settings Page
 *
 * Manage the values that appear in dropdowns and status fields throughout the app.
 * Admin-only.
 */

import { EntityList } from "@/components/universal/entity-list";
import { enumValueEntity } from "@/entities/enum-value";

export default function StatusOptionsPage() {
  return (
    <EntityList
      entity={enumValueEntity}
      basePath="/settings/status-options"
    />
  );
}
