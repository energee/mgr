"use client";

/**
 * Beer Styles Settings Page
 *
 * Manage BJCP styles and custom brewery styles.
 */

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, BookOpen } from "lucide-react";
import { EntityList } from "@/components/universal/entity-list";
import { beerStyleEntity } from "@/entities/beer-style";

export default function BeerStylesPage() {
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
            <BookOpen className="h-6 w-6" />
            Beer Styles
          </h1>
          <p className="text-muted-foreground">
            BJCP style guidelines and custom brewery styles
          </p>
        </div>
      </div>

      {/* Entity List */}
      <EntityList
        entity={beerStyleEntity}
        basePath="/settings/beer-styles"
      />
    </div>
  );
}
