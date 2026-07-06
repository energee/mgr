"use client";

/**
 * Cellar Page
 *
 * Tank-map view of the cellar: every active vessel as a tile grouped by
 * type, with occupying batch, fill level, days in tank, and quick actions
 * (transfer, mark clean). The table view of the same data lives at
 * /production/vessels.
 */

import { CellarBoard } from "@/components/domain/vessel/cellar-board";

export default function CellarPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Cellar</h1>
        <p className="text-sm text-muted-foreground">
          Tanks grouped by type — who&apos;s in what, how full, and for how long.
        </p>
      </div>
      <CellarBoard />
    </div>
  );
}
