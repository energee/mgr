"use client";

/**
 * Keg Types Settings Page
 *
 * Manage keg sizes used for packaging and inventory tracking.
 * Uses the universal EntityList component with the kegTypeEntity config.
 */

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Container } from "lucide-react";
import { EntityList } from "@/components/universal/entity-list";
import { kegTypeEntity } from "@/entities/keg-type";

export default function KegTypesPage() {
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
            <Container className="h-6 w-6" />
            Keg Types
          </h1>
          <p className="text-muted-foreground">
            Manage keg sizes for inventory and deposit tracking
          </p>
        </div>
      </div>

      {/* Entity List */}
      <EntityList
        entity={kegTypeEntity}
        basePath="/settings/keg-types"
      />
    </div>
  );
}
