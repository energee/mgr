"use client";

/**
 * Keg Inventory Page
 *
 * Track keg quantities by type, state, and location.
 * Uses the universal EntityList component with the kegInventoryEntity config.
 */

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Container } from "lucide-react";
import { EntityList } from "@/components/universal/entity-list";
import { kegInventoryEntity } from "@/entities/keg-inventory";

export default function KegInventoryPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/inventory">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Container className="h-6 w-6" />
            Keg Inventory
          </h1>
          <p className="text-muted-foreground">
            Track keg quantities by type, state, and location
          </p>
        </div>
      </div>

      {/* Entity List */}
      <EntityList
        entity={kegInventoryEntity}
        basePath="/inventory/kegs"
      />
    </div>
  );
}
