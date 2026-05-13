"use client";

/**
 * ExportMenu
 *
 * Standardized export dropdown for report pages (audit F-110). Previously
 * only the TTB report had export controls; the other five had none.
 *
 * Wraps the existing `toCSV` + `downloadCSV` helpers from
 * `src/lib/report-export.ts` so every consumer gets the same CSV escape
 * rules and filename pattern.
 *
 * Usage:
 *   <ExportMenu filename="batch-cost-2026-05.csv" rows={tableRows} />
 *
 * Optional `columns` argument lets the caller pick a column subset and
 * rename headers (mirrors `toCSV`'s API). Optional `onPrint` adds a
 * Print menu item that defers to the page's existing print flow.
 */

import { Download, Printer, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toCSV, downloadCSV } from "@/lib/report-export";

export type ExportMenuProps = {
  /** Filename suggested to the browser. Include extension. */
  filename: string;
  /** Rows to export. Each row is a flat object of column → value. */
  rows: Array<Record<string, string | number | null | undefined>>;
  /** Optional column projection / rename. Defaults to keys of rows[0]. */
  columns?: { key: string; header: string }[];
  /** Optional Print callback. Hides the Print item when omitted. */
  onPrint?: () => void;
  /** Whether the menu trigger is disabled (e.g. zero rows). */
  disabled?: boolean;
};

export function ExportMenu({
  filename,
  rows,
  columns,
  onPrint,
  disabled,
}: ExportMenuProps) {
  const isEmpty = rows.length === 0;

  const handleCsv = () => {
    const csv = toCSV(rows, columns);
    downloadCSV(csv, filename);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled || isEmpty}>
          <Download className="h-4 w-4 mr-2" />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={handleCsv}>
          <FileText className="h-4 w-4 mr-2" />
          Download CSV
        </DropdownMenuItem>
        {onPrint && (
          <DropdownMenuItem onSelect={onPrint}>
            <Printer className="h-4 w-4 mr-2" />
            Print
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
