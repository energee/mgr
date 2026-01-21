"use client";

/**
 * Enum Registry Settings Page
 *
 * List all enum values with filtering by type.
 * Admin-only management of system dropdowns and statuses.
 */

import Link from "next/link";
import { EntityList } from "@/components/universal/entity-list";
import { enumValueEntity } from "@/entities/enum-value";
import { Button } from "@/components/ui/button";
import { ArrowLeft, List } from "lucide-react";

export default function EnumRegistryPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/settings">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <List className="h-6 w-6" />
            Enum Registry
          </h1>
          <p className="text-muted-foreground">
            Manage system enums and dropdown values
          </p>
        </div>
      </div>

      {/* Entity List */}
      <EntityList
        entity={enumValueEntity}
        basePath="/settings/enums"
      />
    </div>
  );
}
