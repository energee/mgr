"use client";

/**
 * Brands Settings Page
 *
 * Manage beer brands and products.
 */

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Beer } from "lucide-react";
import { EntityList } from "@/components/universal/entity-list";
import { brandEntity } from "@/entities/brand";

export default function BrandsPage() {
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
            <Beer className="h-6 w-6" />
            Brands
          </h1>
          <p className="text-muted-foreground">
            Manage your beer brands and products
          </p>
        </div>
      </div>

      {/* Entity List */}
      <EntityList
        entity={brandEntity}
        basePath="/settings/brands"
      />
    </div>
  );
}
