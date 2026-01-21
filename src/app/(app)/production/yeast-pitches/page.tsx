"use client";

/**
 * Yeast Pitches List Page
 *
 * Track individual yeast pitches from purchase through repitching.
 * Uses the universal EntityList component with yeastPitchEntity config.
 */

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FlaskConical } from "lucide-react";
import { EntityList } from "@/components/universal/entity-list";
import { yeastPitchEntity } from "@/entities/yeast-pitch";

export default function YeastPitchesPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/production">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FlaskConical className="h-6 w-6" />
            Yeast Pitches
          </h1>
          <p className="text-muted-foreground">
            Track yeast inventory, lineage, and viability
          </p>
        </div>
      </div>

      {/* Entity List */}
      <EntityList
        entity={yeastPitchEntity}
        basePath="/production/yeast-pitches"
      />
    </div>
  );
}
