"use client";

/**
 * Allocations List Page
 *
 * Unified allocation audit trail with quick depletion actions (audit 9.4):
 * Record Sample / Taproom Depletion / Write Off open a guided dialog that
 * inserts the right allocation (source picker, no raw UUIDs) instead of the
 * generic allocation form.
 */

import { useState } from "react";
import { EntityList } from "@/components/universal/entity-list";
import { allocationEntity } from "@/entities/allocation";
import { Button } from "@/components/ui/button";
import { FlaskConical, Beer, Trash2 } from "lucide-react";
import {
  QuickDepletionDialog,
  type QuickDepletionMode,
} from "@/components/domain/inventory/quick-depletion-dialog";

export default function AllocationsPage() {
  const [depletionMode, setDepletionMode] = useState<QuickDepletionMode | null>(null);

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
    </div>
  );
}
