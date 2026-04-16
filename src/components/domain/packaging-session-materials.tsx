"use client";

/**
 * PackagingSessionMaterials — Read-only material requirements preview for a packaging session.
 *
 * Calculates material need by multiplying each line item's planned_quantity by the
 * corresponding selling format's bill of materials (BOM), then compares against on-hand
 * inventory. Highlights shortfalls and links to /purchasing/material-planning when any exist.
 */

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSessionMaterialPreview } from "@/hooks/use-material-planning";
import { EmptyStateHint } from "@/components/universal/empty-state-hint";

// =============================================================================
// Types
// =============================================================================

type PackagingSessionMaterialsProps = {
  sessionId: string;
};

/** Props received from entity section rendering — data is the full entity row. */
type SectionProps = {
  data: { id: string };
};

// =============================================================================
// Component
// =============================================================================

/**
 * Renders a table of materials required for a packaging session, with columns for
 * Material, Needed, On Hand, and Shortfall. A destructive Badge is shown when shortfall > 0.
 * Includes an alert and link to material planning if any shortfalls are found.
 */
export function PackagingSessionMaterials({ sessionId }: PackagingSessionMaterialsProps) {
  const { data: materials, isLoading } = useSessionMaterialPreview(sessionId);

  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground py-4">
        Calculating material requirements…
      </p>
    );
  }

  if (!materials || materials.length === 0) {
    return (
      <EmptyStateHint
        message="No material requirements. Add line items with selling formats that have a bill of materials (BOM) configured."
        href="/settings/selling-formats"
        linkLabel="Set up BOMs in Settings > Selling Formats"
      />
    );
  }

  const hasShortfalls = materials.some((m) => m.shortfall > 0);

  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Material</TableHead>
            <TableHead className="text-right">Needed</TableHead>
            <TableHead className="text-right">On Hand</TableHead>
            <TableHead className="text-right">Shortfall</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {materials.map((m) => (
            <TableRow key={m.inventory_item_id}>
              <TableCell>
                <span className="font-medium">{m.inventory_item_name}</span>
                {m.unit_of_measure && (
                  <span className="ml-1 text-xs text-muted-foreground">
                    ({m.unit_of_measure})
                  </span>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {m.total_required.toLocaleString()}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {m.on_hand_quantity.toLocaleString()}
              </TableCell>
              <TableCell className="text-right">
                {m.shortfall > 0 ? (
                  <Badge variant="destructive">
                    {m.shortfall.toLocaleString()}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">--</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {hasShortfalls && (
        <p className="text-sm text-destructive">
          Some materials have shortfalls.{" "}
          <Link
            href="/purchasing/material-planning"
            className="underline underline-offset-2 hover:opacity-80"
          >
            View material planning
          </Link>{" "}
          to create purchase orders.
        </p>
      )}
    </div>
  );
}

/**
 * Section adapter — receives the full entity row as `data` from EntityDetailUnified
 * and forwards only the session ID to PackagingSessionMaterials.
 */
export function PackagingSessionMaterialsSection({ data }: SectionProps) {
  return <PackagingSessionMaterials sessionId={data.id} />;
}
