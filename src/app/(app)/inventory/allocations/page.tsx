"use client";

/**
 * Allocations List Page
 *
 * Unified allocation audit trail with guided quick actions (audit 9.4 + 27):
 * Record Sample / Taproom Depletion / Write Off open QuickDepletionDialog,
 * and Count / Adjust opens the guided cycle-count dialog — all insert the
 * right allocation (source picker, no raw UUIDs) instead of routing users
 * through the generic allocation form.
 */

import { useState } from "react";
import { EntityList } from "@/components/universal/entity-list";
import { allocationEntity } from "@/entities/allocation";
import { Button } from "@/components/ui/button";
import { FlaskConical, Beer, Trash2, ClipboardCheck } from "lucide-react";
import {
  QuickDepletionDialog,
  type QuickDepletionMode,
} from "@/components/domain/inventory/quick-depletion-dialog";
import { CountAdjustDialog } from "@/components/domain/inventory/count-adjust-dialog";

export default function AllocationsPage() {
  const [depletionMode, setDepletionMode] = useState<QuickDepletionMode | null>(null);
  const [countOpen, setCountOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => setDepletionMode("sample")}>
          <FlaskConical className="h-4 w-4 mr-2" />
          Record Sample
        </Button>
        <Button variant="outline" size="sm" onClick={() => setDepletionMode("taproom")}>
          <Beer className="h-4 w-4 mr-2" />
          Taproom Depletion
        </Button>
        <Button variant="outline" size="sm" onClick={() => setDepletionMode("write_off")}>
          <Trash2 className="h-4 w-4 mr-2" />
          Write Off
        </Button>
        <Button variant="outline" size="sm" onClick={() => setCountOpen(true)}>
          <ClipboardCheck className="h-4 w-4 mr-2" />
          Count / Adjust
        </Button>
      </div>

      <EntityList entity={allocationEntity} basePath="/inventory/allocations" />

      {depletionMode && (
        <QuickDepletionDialog
          mode={depletionMode}
          open={depletionMode !== null}
          onOpenChange={(o) => {
            if (!o) setDepletionMode(null);
          }}
        />
      )}

      <CountAdjustDialog open={countOpen} onOpenChange={setCountOpen} />
    </div>
  );
}
