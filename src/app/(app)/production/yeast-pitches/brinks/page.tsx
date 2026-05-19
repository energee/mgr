"use client";

/**
 * Brinks Management Page
 *
 * Dashboard view of all brink vessels and their current yeast pitches.
 * Shows viability, remaining quantity, and generation at a glance.
 */

import { YeastBrinksOverview } from "@/components/domain/yeast/yeast-brinks-overview";

export default function BrinksPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Yeast Brinks</h1>
        <p className="text-muted-foreground">
          Overview of brink vessels and active yeast pitches.
        </p>
      </div>
      <YeastBrinksOverview />
    </div>
  );
}
