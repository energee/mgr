"use client";

/**
 * Yeast Strains Settings Page
 *
 * Manage yeast strain catalog for recipe building.
 * Uses the universal EntityList component with yeastStrainEntity config.
 */

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FlaskConical } from "lucide-react";
import { EntityList } from "@/components/universal/entity-list";
import { yeastStrainEntity } from "@/entities/yeast-strain";

export default function YeastStrainsPage() {
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
            <FlaskConical className="h-6 w-6" />
            Yeast Strains
          </h1>
          <p className="text-muted-foreground">
            Manage yeast strain catalog for recipe building
          </p>
        </div>
      </div>

      {/* Entity List */}
      <EntityList
        entity={yeastStrainEntity}
        basePath="/settings/yeasts"
      />
    </div>
  );
}
