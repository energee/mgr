"use client";

/**
 * Locations Settings Page
 *
 * Manage physical locations (breweries, warehouses, taprooms, storage).
 * Uses the universal EntityList component with the locationEntity config.
 */

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, MapPin } from "lucide-react";
import { EntityList } from "@/components/universal/entity-list";
import { locationEntity } from "@/entities/location";

export default function LocationsPage() {
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
            <MapPin className="h-6 w-6" />
            Locations
          </h1>
          <p className="text-muted-foreground">
            Manage warehouse and storage locations
          </p>
        </div>
      </div>

      {/* Entity List */}
      <EntityList
        entity={locationEntity}
        basePath="/settings/locations"
      />
    </div>
  );
}
