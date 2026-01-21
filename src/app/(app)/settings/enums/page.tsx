/**
 * Enum Registry Settings Page
 *
 * List all enum values with filtering by type.
 * Admin-only management of system dropdowns and statuses.
 */

"use client";

import Link from "next/link";
import { EntityList } from "@/components/universal/entity-list";
import { enumValueEntity } from "@/entities/enum-value";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

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
          <h1 className="text-2xl font-bold">Enum Registry</h1>
          <p className="text-muted-foreground">
            Manage system enums and dropdown values
          </p>
        </div>
      </div>

      {/* Entity List */}
      <EntityList
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        entity={enumValueEntity as any}
        basePath="/settings/enums"
      />
    </div>
  );
}
