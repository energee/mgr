"use client";

/**
 * Package Formats Settings Page
 *
 * Manage package types (cans, bottles, kegs, etc.) used in packaging sessions.
 * Uses the universal EntityList component with the packageTypeEntity config.
 */

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Package } from "lucide-react";
import { EntityList } from "@/components/universal/entity-list";
import { packageTypeEntity } from "@/entities/package-type";

export default function PackageFormatsPage() {
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
            <Package className="h-6 w-6" />
            Package Formats
          </h1>
          <p className="text-muted-foreground">
            Manage package types for packaging sessions
          </p>
        </div>
      </div>

      {/* Entity List */}
      <EntityList
        entity={packageTypeEntity}
        basePath="/settings/formats"
      />
    </div>
  );
}
