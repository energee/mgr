"use client";

/**
 * Shared scaffold for the report pages under src/app/(app)/reports/.
 *
 * Every report page hand-built the same skeleton: back-link header with an
 * ExportMenu, a filter card, an error alert, a grid of summary stat cards,
 * one or more table cards with loading skeletons / empty states, and a
 * closing disclaimer note. These components centralize that scaffold; each
 * page keeps only its queries, its summary math (src/domain/reports/), and any
 * genuinely report-specific rendering (expandable rows, category grouping).
 *
 * Components:
 * - ReportPage        — page frame: header + filter + error alert + note
 * - ReportFilterCard  — the filter/period-selection card
 * - ReportField       — one labelled control inside a filter card
 * - ReportDateRangeFilter — the shared From/To date-range filter card
 * - ReportSummaryCards— responsive grid of stat cards with loading skeletons
 * - StatValue         — the standard big-number stat body
 * - ReportTableCard   — Card wrapper handling loading skeletons + empty state
 * - ReportTableState  — the same loading/empty switch without the Card chrome
 * - ReportTable       — column-config table with optional row grouping/expansion/footer
 * - ExpandChevron     — chevron cell content for click-to-expand rows
 * - ExpandedDetailRow — full-width detail row for expandable tables
 *
 * Everything here is domain-blind: these components take ReactNode/generic
 * rows and know nothing about batches or BBLs. The brewery-specific drill-down
 * table lives next door in ./ingredient-detail-table.
 *
 * Not migrated: reports/trace (no filter card, summary cards, export or note —
 * it already factors its own TraceSection) and reports/ttb (owned elsewhere).
 */

import React from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, ChevronDown, ChevronRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { ExportMenu, type ExportMenuProps } from "@/components/reports/export-menu";

// =============================================================================
// ReportPage
// =============================================================================

export type ReportPageProps = {
  /** Page heading. */
  title: string;
  /** Subtitle under the heading. */
  description: React.ReactNode;
  /** Header ExportMenu config; omit for reports without CSV export. */
  exportConfig?: ExportMenuProps;
  /** Filter/period card (typically a ReportFilterCard), rendered after the header. */
  filter?: React.ReactNode;
  /** Query error; renders the destructive alert when truthy. */
  error?: unknown;
  /** Fallback message when the error is not an Error instance. */
  errorFallback?: string;
  /** Disclaimer note rendered in a muted card at the bottom. */
  note?: React.ReactNode;
  children: React.ReactNode;
};

/**
 * Page frame shared by the report pages: back-link header (+ optional
 * ExportMenu), filter card, error alert, content, and disclaimer note.
 */
export function ReportPage({
  title,
  description,
  exportConfig,
  filter,
  error,
  errorFallback = "Failed to load report data",
  note,
  children,
}: ReportPageProps) {
  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/reports">
          <Button variant="ghost" size="icon" aria-label="Back to reports">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="text-muted-foreground">{description}</p>
        </div>
        {exportConfig && <ExportMenu {...exportConfig} />}
      </div>

      {filter}

      {/* Error */}
      {!!error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error Loading Report</AlertTitle>
          <AlertDescription>
            {error instanceof Error ? error.message : errorFallback}
          </AlertDescription>
        </Alert>
      )}

      {children}

      {/* Disclaimer */}
      {note && (
        <Card className="bg-muted/50">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              <strong>Note:</strong> {note}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// =============================================================================
// ReportFilterCard
// =============================================================================

/** Filter/period-selection card rendered under the report header. */
export function ReportFilterCard({
  title,
  description,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Filter controls; laid out in a wrapping bottom-aligned row. */
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <div className="flex items-end gap-4 flex-wrap">{children}</div>
      </CardContent>
    </Card>
  );
}

/** Labelled filter control (label above the control) for ReportFilterCard. */
export function ReportField({
  label,
  htmlFor,
  children,
}: {
  label: React.ReactNode;
  /**
   * `id` of the control this label names. Pass it whenever the control renders
   * a real form element (e.g. an `<Input>`) so clicking the label focuses it
   * and assistive tech picks up the accessible name. Radix `Select` triggers
   * are labelled by composition and do not need it.
   */
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

/**
 * From/To date-range filter card — the shared shape used by the COGS and
 * Batch Cost reports. A report needing extra controls beside the two pickers
 * should compose ReportFilterCard/ReportField directly rather than growing a
 * children slot here.
 */
export function ReportDateRangeFilter({
  title = "Date Range",
  description,
  fromDate,
  toDate,
  onFromDateChange,
  onToDateChange,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  fromDate: string;
  toDate: string;
  onFromDateChange: (value: string) => void;
  onToDateChange: (value: string) => void;
}) {
  return (
    <ReportFilterCard title={title} description={description}>
      <ReportField label="From">
        <DatePicker value={fromDate} onChange={(v) => v && onFromDateChange(v)} />
      </ReportField>
      <ReportField label="To">
        <DatePicker value={toDate} onChange={(v) => v && onToDateChange(v)} />
      </ReportField>
    </ReportFilterCard>
  );
}

// =============================================================================
// ReportSummaryCards
// =============================================================================

export type ReportSummaryCard = {
  /** Small icon shown next to the label. */
  icon?: LucideIcon;
  label: React.ReactNode;
  /** Rendered value (already formatted). */
  value: React.ReactNode;
  /** Optional caption under the value. */
  sub?: React.ReactNode;
  /** Skeleton width class while loading (default w-24). */
  skeletonClassName?: string;
};

/** Responsive grid of summary stat cards with per-card loading skeletons. */
export function ReportSummaryCards({
  cards,
  loading,
  columns = 3,
}: {
  cards: ReportSummaryCard[];
  loading: boolean;
  /** md+ column count (grid is single-column on mobile). */
  columns?: 3 | 4;
}) {
  const gridClass =
    columns === 4
      ? "grid grid-cols-1 md:grid-cols-4 gap-4"
      : "grid grid-cols-1 md:grid-cols-3 gap-4";
  return (
    <div className={gridClass}>
      {cards.map((card, i) => (
        <Card key={i}>
          <CardHeader className="pb-2">
            {/* Flex row only when there is an icon to sit beside the label,
                matching the pre-scaffold markup on icon-less cards. */}
            <CardTitle
              className={
                card.icon
                  ? "text-sm font-medium text-muted-foreground flex items-center gap-1"
                  : "text-sm font-medium text-muted-foreground"
              }
            >
              {card.icon && <card.icon className="h-4 w-4" />}
              {card.label}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className={`h-8 ${card.skeletonClassName ?? "w-24"}`} />
            ) : (
              <>
                {card.value}
                {card.sub}
              </>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** Standard big-number stat value used inside a ReportSummaryCard. */
export function StatValue({ children }: { children: React.ReactNode }) {
  return <div className="text-2xl font-bold font-mono">{children}</div>;
}

// =============================================================================
// ReportTableCard
// =============================================================================

/**
 * Card wrapper for a report table: renders loading skeleton rows, an empty
 * message, or the children (the table) as appropriate.
 */
export function ReportTableCard({
  title,
  description,
  loading,
  skeletonRows = 5,
  isEmpty,
  emptyMessage,
  children,
  footer,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  loading: boolean;
  skeletonRows?: number;
  isEmpty: boolean;
  emptyMessage: React.ReactNode;
  children: React.ReactNode;
  /** Optional content rendered under the table (e.g. caveat text). */
  footer?: React.ReactNode;
}) {
  return (
    <Card>
      {title && (
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
      )}
      <CardContent>
        <ReportTableState
          loading={loading}
          skeletonRows={skeletonRows}
          isEmpty={isEmpty}
          emptyMessage={emptyMessage}
        >
          {children}
        </ReportTableState>
        {footer}
      </CardContent>
    </Card>
  );
}

/** Loading-skeleton / empty-state / content switch without the Card chrome. */
export function ReportTableState({
  loading,
  skeletonRows = 5,
  isEmpty,
  emptyMessage,
  children,
}: {
  loading: boolean;
  skeletonRows?: number;
  isEmpty: boolean;
  emptyMessage: React.ReactNode;
  children: React.ReactNode;
}) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(skeletonRows)].map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }
  if (isEmpty) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }
  return <>{children}</>;
}

// =============================================================================
// ReportTable
// =============================================================================

export type ReportColumn<T> = {
  header: React.ReactNode;
  /** Class for the TableHead (e.g. "text-right"). */
  headClassName?: string;
  /** Class for each TableCell; a function receives the row. */
  cellClassName?: string | ((row: T) => string);
  cell: (row: T) => React.ReactNode;
};

/**
 * Column-config table for the common report case (flat rows, optional footer
 * row, optional click-to-expand detail row rendered after a row).
 */
export function ReportTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  rowClassName,
  renderBeforeRow,
  renderAfterRow,
  footer,
}: {
  columns: ReportColumn<T>[];
  rows: T[];
  /** Stable React key per row; receives the row index for list-position keys. */
  rowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  rowClassName?: string;
  /** Extra row(s) rendered before a data row (e.g. a group header). */
  renderBeforeRow?: (row: T, index: number) => React.ReactNode;
  /** Extra row(s) rendered after a data row (e.g. expanded detail, subtotal). */
  renderAfterRow?: (row: T, index: number) => React.ReactNode;
  /** Footer row(s), e.g. a totals TableRow. */
  footer?: React.ReactNode;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((col, i) => (
            <TableHead key={i} className={col.headClassName}>
              {col.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, rowIndex) => (
          <React.Fragment key={rowKey(row, rowIndex)}>
            {renderBeforeRow?.(row, rowIndex)}
            <TableRow
              className={rowClassName}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((col, i) => (
                <TableCell
                  key={i}
                  className={
                    typeof col.cellClassName === "function"
                      ? col.cellClassName(row)
                      : col.cellClassName
                  }
                >
                  {col.cell(row)}
                </TableCell>
              ))}
            </TableRow>
            {renderAfterRow?.(row, rowIndex)}
          </React.Fragment>
        ))}
        {footer}
      </TableBody>
    </Table>
  );
}

/** Chevron cell content for click-to-expand rows. */
export function ExpandChevron({ expanded }: { expanded: boolean }) {
  return expanded ? (
    <ChevronDown className="h-4 w-4" />
  ) : (
    <ChevronRight className="h-4 w-4" />
  );
}

/**
 * Full-width muted detail row rendered under an expanded table row.
 */
export function ExpandedDetailRow({
  colSpan,
  title,
  children,
}: {
  colSpan: number;
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="bg-muted/30 p-0">
        <div className="px-8 py-4">
          <h4 className="text-sm font-semibold mb-3">{title}</h4>
          {children}
        </div>
      </TableCell>
    </TableRow>
  );
}
