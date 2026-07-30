"use client";

/**
 * TTB Report Page (Form 5130.9)
 *
 * Brewer's Report of Operations for federal tax compliance.
 * Calculates production volumes by tax class for the reporting period.
 *
 * Uses database functions:
 * - get_ttb_report(year, month) - Full report data by tax class
 * - get_ttb_production_summary(year, month) - Production details
 *
 * Each row is run through the form's two accounting identities
 * (checkRowIdentities from @/domain/ttb-utils) unless its tax class is on the
 * exemption list; failures render a visible warning so a non-balancing report is
 * never silently filed.
 *
 * The cellar row is the one exempt class — exempt rather than passed: its volume
 * lives in the in-process columns, which the identities do not reference, and
 * those columns are a live snapshot of batches currently in fermenting/
 * conditioning/packaging — not a period-end balance (issue #618). Exempt tax
 * classes are labelled as "not checked" in the UI instead of raising the
 * warning, which would otherwise fire on every month an active brewery has.
 * Both summary cards below (the get_ttb_report table and the legacy fallback)
 * carry that caveat via TTBReportCaveats.
 *
 * The Total column is scoped per line, not per column (issue #670, see
 * TOTAL_SCOPE_BY_COLUMN in @/domain/ttb-utils). Part I's inventory and
 * production lines total the packaged tax classes only — adding the cellar
 * column there counted beer brewed in the period alongside the same beer once
 * packaged — and are marked with PACKAGED_TOTAL_MARKER. Part II's removals and
 * the beer-in-process line total every class: cellar removals are beer that left
 * the brewery and no packaged line repeats them (migration 00274 / issue #603).
 * The same split applies to the four summary cards, whose scopes differ from
 * each other and are stated by getSummaryCardScopeNote. On the legacy fallback
 * path there are no tax classes at all — those cards are batch volumes — so both
 * notes are suppressed there.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { reportKeys } from "@/lib/query-keys";
import {
  getTaxClassLabel,
  formatTtbBbl,
  MONTHS,
  calculateTotals,
  checkRowIdentities,
  collectIdentityFailures,
  collectIdentityExemptions,
  formatIdentityExemptionDisclosure,
  getSummaryCardScopeNote,
  getTotalScopeCaveat,
  totalScopedLineLabel,
  TOTAL_COLUMN_LABEL,
  IN_PROCESS_SNAPSHOT_LABEL,
  EMPTY_TOTALS,
  type TTBReportRow,
} from "@/domain/ttb-utils";
import { TTBReportCaveats } from "@/components/reports/ttb-report-caveats";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Download, Printer, Calendar, AlertCircle, Beer, Package, Boxes, FileSpreadsheet } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Link from "next/link";
// No cast needed on the way in: the export functions take `TTBReportData`,
// which is an alias of the `TTBReportRow` this page already holds. A cast here
// would suppress exactly the page/export drift that alias exists to prevent.
import {
  exportTTBReportToCSV,
  exportBatchDetailsToCSV,
  openTTBPrintView,
} from "@/lib/report-export";
import { batchEntity } from "@/entities/batch";
import { dynamicRpc } from "@/services/types";
import { getStateLabel } from "@/types/entity";
import { log } from "@/lib/client-logger";

// =============================================================================
// Types
// =============================================================================

// TTBReportRow imported from @/domain/ttb-utils (single source of truth for
// the get_ttb_report row shape).

type BatchSummary = {
  id: string;
  batch_code: string;
  name: string;
  status: string;
  volume_bbl: number | null;
  completed_at: string | null;
}

// =============================================================================
// Helper Functions
// =============================================================================

// getTaxClassLabel and formatTtbBbl imported from @/domain/ttb-utils

function getTaxClassIcon(taxClass: string) {
  switch (taxClass) {
    case "cellar":
      return <Beer className="h-4 w-4" />;
    case "keg":
      return <Package className="h-4 w-4" />;
    case "bottled":
      return <Boxes className="h-4 w-4" />;
    default:
      return null;
  }
}

/**
 * Identity disclosure for the legacy fallback card. When `get_ttb_report` is
 * unavailable there are no per-tax-class rows at all, so *neither* accounting
 * identity was evaluated — not merely the cellar exemption. Say so rather than
 * let a reader infer the figures were checked.
 */
const LEGACY_NO_IDENTITY_CHECKS_NOTE =
  "Not accounting-identity checked: this fallback summary is built from batch " +
  "volumes because the per-tax-class report function is unavailable, so neither " +
  "Form 5130.9 accounting identity could be evaluated.";

// Generate year options (current year and 3 years back)
function getYearOptions(): number[] {
  const currentYear = new Date().getFullYear();
  return Array.from({ length: 4 }, (_, i) => currentYear - i);
}

// Month names
// =============================================================================
// Component
// =============================================================================

export default function TTBReportPage() {
  const supabase = createClient();
  const currentDate = new Date();
  const [year, setYear] = useState(currentDate.getFullYear());
  const [month, setMonth] = useState(currentDate.getMonth() + 1);

  // Fetch TTB report data using the database function
  // Note: get_ttb_report function is added in migration 00041
  const { data: reportData, isLoading: reportLoading, error: reportError } = useQuery({
    queryKey: reportKeys.ttb({ year, month }),
    queryFn: async () => {
      const { data, error } = await dynamicRpc(supabase, "get_ttb_report", {
        p_year: year,
        p_month: month,
      });

      if (error) {
        log.error("TTB Report Error:", error);
        // If function doesn't exist, fall back to legacy data
        if (error.code === "42883" || error.message?.includes("does not exist")) {
          return null; // Function not found
        }
        throw error;
      }

      return data as TTBReportRow[];
    },
  });

  // Fetch batch details for the period (for detail section)
  const { data: batchData, isLoading: batchLoading } = useQuery({
    queryKey: reportKeys.ttbBatches(year, month),
    queryFn: async () => {
      // Full local-time month boundaries: completed_at is timestamptz, so
      // comparing against bare UTC dates would attribute evening completions
      // near month end to the wrong month for breweries west of UTC.
      const periodStart = new Date(year, month - 1, 1).toISOString();
      const periodEndExclusive = new Date(year, month, 1).toISOString();

      // Fetch in parallel: the two queries are independent.
      const [
        // Batches completed in the period (filter by completed_at, stamped by
        // trigger on transition to "completed" — migration 00175). Note:
        // completed_at was backfilled from updated_at for batches completed
        // before that migration, so period attribution for those older
        // batches is approximate.
        { data: completedBatches, error: completedError },
        // Batches in production (fermenting, conditioning, packaging)
        { data: inProgressBatches, error: inProgressError },
      ] = await Promise.all([
        supabase
          .from("batches")
          .select("id, batch_code, name, status, volume_bbl, completed_at")
          .eq("status", "completed")
          .gte("completed_at", periodStart)
          .lt("completed_at", periodEndExclusive),
        supabase
          .from("batches")
          .select("id, batch_code, name, status, volume_bbl")
          .in("status", ["fermenting", "conditioning", "packaging"]),
      ]);

      if (completedError) throw completedError;
      if (inProgressError) throw inProgressError;

      const completedVolume = (completedBatches || []).reduce(
        (sum, b) => sum + (b.volume_bbl || 0),
        0
      );

      const inProgressVolume = (inProgressBatches || []).reduce(
        (sum, b) => sum + (b.volume_bbl || 0),
        0
      );

      return {
        completedBatches: completedBatches || [],
        inProgressBatches: inProgressBatches || [],
        completedVolume,
        inProgressVolume,
      };
    },
  });

  const isLoading = reportLoading || batchLoading;
  const monthName = MONTHS[month - 1];

  // Calculate totals from report data (falls back to legacy batch sums when
  // get_ttb_report is unavailable).
  const totals = reportData
    ? calculateTotals(reportData)
    : {
        ...EMPTY_TOTALS,
        beerProduced: batchData?.completedVolume || 0,
        inProcessEnding: batchData?.inProgressVolume || 0,
      };

  // TTB Form 5130.9 accounting-identity checks. Every row is checked unless its
  // tax class is explicitly exempt (today only cellar, whose volume lives in
  // the in-process columns the identities do not read) — an unrecognised class
  // is checked, not excused, so a future finished-goods class cannot slip out of
  // the alert silently. A failing row means the report disagrees with its own
  // math (e.g. removals not deducted from ending inventory) and must be reviewed
  // before filing. Exempt rows are disclosed as unchecked below the table rather
  // than warned about.
  const identityChecks = (reportData ?? []).map(checkRowIdentities);

  // Total-column and summary-card scope notes (issue #670). Both are null when
  // nothing in the report is exempt, and both are derived from the rows, so the
  // legacy fallback (no rows) renders neither.
  const totalScopeCaveat = getTotalScopeCaveat(reportData ?? []);
  const summaryCardScopeNote = getSummaryCardScopeNote(reportData ?? []);
  const identityFailures = collectIdentityFailures(identityChecks);
  const identityExemptions = collectIdentityExemptions(identityChecks);

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
          <h1 className="text-2xl font-bold">
            TTB Report (Form 5130.9)
          </h1>
          <p className="text-muted-foreground">
            Brewer&apos;s Report of Operations
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!reportData || reportData.length === 0}
            onClick={() => {
              if (reportData && reportData.length > 0) {
                openTTBPrintView(reportData, year, month);
              }
            }}
          >
            <Printer className="h-4 w-4 mr-2" />
            Print
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={!reportData || reportData.length === 0}
              >
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  if (reportData && reportData.length > 0) {
                    exportTTBReportToCSV(reportData, year, month);
                  }
                }}
              >
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Export Report (CSV)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  if (batchData?.completedBatches) {
                    exportBatchDetailsToCSV(batchData.completedBatches, year, month, "completed");
                  }
                }}
                disabled={!batchData?.completedBatches?.length}
              >
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Export Completed Batches (CSV)
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  if (batchData?.inProgressBatches) {
                    exportBatchDetailsToCSV(batchData.inProgressBatches, year, month, "in-process");
                  }
                }}
                disabled={!batchData?.inProgressBatches?.length}
              >
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Export In-Process Batches (CSV)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Period Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Calendar className="h-5 w-5" />
            Reporting Period
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-4">
            <div className="space-y-2">
              <Label>Year</Label>
              <Select value={year.toString()} onValueChange={(v) => setYear(parseInt(v))}>
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {getYearOptions().map((y) => (
                    <SelectItem key={y} value={y.toString()}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Month</Label>
              <Select value={month.toString()} onValueChange={(v) => setMonth(parseInt(v))}>
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => (
                    <SelectItem key={i} value={(i + 1).toString()}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="pb-2 text-muted-foreground font-medium">
              {monthName} {year}
            </div>
          </div>
        </CardContent>
      </Card>

      {reportError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error Loading Report</AlertTitle>
          <AlertDescription>
            {reportError instanceof Error ? reportError.message : "Failed to load TTB report data"}
          </AlertDescription>
        </Alert>
      )}

      {identityFailures.length > 0 && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Report fails TTB accounting identity checks</AlertTitle>
          <AlertDescription>
            <p>
              These figures do not balance — review the source data before
              filing Form 5130.9.
            </p>
            <ul className="list-disc pl-5 mt-1">
              {identityFailures.map((msg) => (
                <li key={msg}>{msg}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Beginning Inventory
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold font-mono">
                {formatTtbBbl(totals.beginningInventory)} <span className="text-sm font-normal text-muted-foreground">BBL</span>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            {/* "Packaged", not "Produced": on the get_ttb_report path this sums
                beer_produced_bbl over the packaged classes only, which 00041
                fills from the production summary's beer_packaged term. Keeping
                the old "Beer Produced" label would read 0.00 in a month with
                brewing but no packaging (issue #670). The legacy fallback fills
                the same card from batchData.completedVolume, which really is
                beer brewed, so that path keeps the original label. */}
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {reportData && reportData.length > 0 ? "Beer Packaged" : "Beer Produced"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold font-mono">
                {formatTtbBbl(totals.beerProduced)} <span className="text-sm font-normal text-muted-foreground">BBL</span>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Removals
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold font-mono">
                {formatTtbBbl(totals.totalRemovals)} <span className="text-sm font-normal text-muted-foreground">BBL</span>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Ending Inventory
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold font-mono">
                {formatTtbBbl(totals.endingInventory)} <span className="text-sm font-normal text-muted-foreground">BBL</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* What the four cards above add up — they do not all have the same scope:
          three are packaged-only, Total Removals is brewery-wide. Only on the
          get_ttb_report path; the legacy fallback has no tax classes, so its
          cards are batch volumes and this sentence would not describe them
          (issue #670). */}
      {summaryCardScopeNote && (
        <p className="text-xs text-muted-foreground">{summaryCardScopeNote}</p>
      )}

      {/* Report by Tax Class */}
      {reportData && reportData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Report by Tax Class</CardTitle>
            <CardDescription>
              TTB Form 5130.9 data organized by package type - {monthName} {year}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[200px]">Line Item</TableHead>
                  {reportData.map((row) => (
                    <TableHead key={row.ttb_tax_class} className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {getTaxClassIcon(row.ttb_tax_class)}
                        {getTaxClassLabel(row.ttb_tax_class)}
                      </div>
                    </TableHead>
                  ))}
                  <TableHead className="text-right font-bold">
                    {TOTAL_COLUMN_LABEL}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Part I - Operations */}
                <TableRow className="bg-muted/50">
                  <TableCell colSpan={reportData.length + 2} className="font-semibold">
                    Part I - Operations in Producing Beer
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    {totalScopedLineLabel(reportData, "Beginning Inventory", "beginning_inventory_bbl")}
                  </TableCell>
                  {reportData.map((row) => (
                    <TableCell key={row.ttb_tax_class} className="text-right font-mono">
                      {formatTtbBbl(row.beginning_inventory_bbl)}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-mono font-bold">
                    {formatTtbBbl(totals.beginningInventory)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    {totalScopedLineLabel(reportData, "Beer Produced/Packaged", "beer_produced_bbl")}
                  </TableCell>
                  {reportData.map((row) => (
                    <TableCell key={row.ttb_tax_class} className="text-right font-mono">
                      {formatTtbBbl(row.beer_produced_bbl)}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-mono font-bold">
                    {formatTtbBbl(totals.beerProduced)}
                  </TableCell>
                </TableRow>
                <TableRow className="border-t-2">
                  <TableCell className="font-medium">
                    {totalScopedLineLabel(reportData, "Total Available", "total_available_bbl")}
                  </TableCell>
                  {reportData.map((row) => (
                    <TableCell key={row.ttb_tax_class} className="text-right font-mono font-medium">
                      {formatTtbBbl(row.total_available_bbl)}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-mono font-bold">
                    {formatTtbBbl(totals.totalAvailable)}
                  </TableCell>
                </TableRow>

                {/* Part II - Removals */}
                <TableRow className="bg-muted/50">
                  <TableCell colSpan={reportData.length + 2} className="font-semibold">
                    Part II - Disposition of Beer
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="pl-6">Taxpaid (Domestic)</TableCell>
                  {reportData.map((row) => (
                    <TableCell key={row.ttb_tax_class} className="text-right font-mono">
                      {formatTtbBbl(row.taxpaid_domestic_bbl)}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-mono font-bold">
                    {formatTtbBbl(totals.taxpaidDomestic)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="pl-6">Taxpaid (Export)</TableCell>
                  {reportData.map((row) => (
                    <TableCell key={row.ttb_tax_class} className="text-right font-mono">
                      {formatTtbBbl(row.taxpaid_export_bbl)}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-mono font-bold">
                    {formatTtbBbl(totals.taxpaidExport)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="pl-6">Tax-Free Samples</TableCell>
                  {reportData.map((row) => (
                    <TableCell key={row.ttb_tax_class} className="text-right font-mono">
                      {formatTtbBbl(row.tax_free_samples_bbl)}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-mono font-bold">
                    {formatTtbBbl(totals.taxFreeSamples)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="pl-6">Losses</TableCell>
                  {reportData.map((row) => (
                    <TableCell key={row.ttb_tax_class} className="text-right font-mono">
                      {formatTtbBbl(row.losses_bbl)}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-mono font-bold">
                    {formatTtbBbl(totals.losses)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="pl-6">Destroyed</TableCell>
                  {reportData.map((row) => (
                    <TableCell key={row.ttb_tax_class} className="text-right font-mono">
                      {formatTtbBbl(row.destroyed_bbl)}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-mono font-bold">
                    {formatTtbBbl(totals.destroyed)}
                  </TableCell>
                </TableRow>
                <TableRow className="border-t-2">
                  <TableCell className="font-medium">Total Removals</TableCell>
                  {reportData.map((row) => (
                    <TableCell key={row.ttb_tax_class} className="text-right font-mono font-medium">
                      {formatTtbBbl(row.total_removals_bbl)}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-mono font-bold">
                    {formatTtbBbl(totals.totalRemovals)}
                  </TableCell>
                </TableRow>

                {/* Ending */}
                <TableRow className="bg-muted/50">
                  <TableCell colSpan={reportData.length + 2} className="font-semibold">
                    Ending Balance
                  </TableCell>
                </TableRow>
                <TableRow className="font-bold">
                  <TableCell>
                    {totalScopedLineLabel(reportData, "Ending Inventory", "ending_inventory_bbl")}
                  </TableCell>
                  {reportData.map((row) => (
                    <TableCell key={row.ttb_tax_class} className="text-right font-mono">
                      {formatTtbBbl(row.ending_inventory_bbl)}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-mono">
                    {formatTtbBbl(totals.endingInventory)}
                  </TableCell>
                </TableRow>

                {/* In-Process — a live snapshot, not a period-end balance (#618) */}
                <TableRow className="bg-muted/50">
                  <TableCell colSpan={reportData.length + 2} className="font-semibold">
                    Beer in Process (Cellar) — current snapshot
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>{IN_PROCESS_SNAPSHOT_LABEL}</TableCell>
                  {reportData.map((row) => (
                    <TableCell key={row.ttb_tax_class} className="text-right font-mono">
                      {formatTtbBbl(row.in_process_ending_bbl)}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-mono font-bold">
                    {formatTtbBbl(totals.inProcessEnding)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            </div>
            <TTBReportCaveats
              periodLabel={`${monthName} ${year}`}
              identityDisclosure={formatIdentityExemptionDisclosure(identityExemptions)}
              totalColumnCaveat={totalScopeCaveat ?? undefined}
            />
          </CardContent>
        </Card>
      )}

      {/* Legacy Summary (if new functions not available) */}
      {(!reportData || reportData.length === 0) && (
        <Card>
          <CardHeader>
            <CardTitle>Report Summary</CardTitle>
            <CardDescription>
              Data for TTB Form 5130.9 - {monthName} {year}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[...Array(8)].map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : (
              <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[60%]">Line Item</TableHead>
                    <TableHead className="text-right">Barrels</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium">
                      Part I - Operations in Producing Beer
                    </TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="pl-6">Beer Produced</TableCell>
                    <TableCell className="text-right font-mono">
                      {formatTtbBbl(batchData?.completedVolume)}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium pt-4">
                      Part II - Beer in Process
                    </TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                  <TableRow>
                    {/* Snapshot of batches in process now, not a month-end balance (#618) */}
                    <TableCell className="pl-6">{IN_PROCESS_SNAPSHOT_LABEL}</TableCell>
                    <TableCell className="text-right font-mono">
                      {formatTtbBbl(batchData?.inProgressVolume)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              {/* Same caveat the get_ttb_report card carries: the honest label
                  never ships without the honest explanation (issue #618). */}
              <TTBReportCaveats
                periodLabel={`${monthName} ${year}`}
                identityDisclosure={LEGACY_NO_IDENTITY_CHECKS_NOTE}
              />
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Batch Detail */}
      <Card>
        <CardHeader>
          <CardTitle>Completed Batches in Period</CardTitle>
          <CardDescription>
            Batches that completed during {monthName} {year}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {batchLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : batchData?.completedBatches.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">
              No batches completed in this period
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Volume (BBL)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batchData?.completedBatches.map((batch: BatchSummary) => (
                  <TableRow key={batch.id}>
                    <TableCell className="font-mono">{batch.batch_code}</TableCell>
                    <TableCell>{batch.name}</TableCell>
                    <TableCell className="text-right font-mono">
                      {formatTtbBbl(batch.volume_bbl)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-bold">
                  <TableCell colSpan={2}>Total</TableCell>
                  <TableCell className="text-right font-mono">
                    {formatTtbBbl(batchData?.completedVolume)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* In Progress Batches */}
      {batchData && batchData.inProgressBatches.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Beer in Process</CardTitle>
            <CardDescription>
              Batches currently in fermentation, conditioning, or packaging
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Volume (BBL)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batchData.inProgressBatches.map((batch) => (
                  <TableRow key={batch.id}>
                    <TableCell className="font-mono">{batch.batch_code}</TableCell>
                    <TableCell>{batch.name}</TableCell>
                    <TableCell>{getStateLabel(batchEntity, batch.status)}</TableCell>
                    <TableCell className="text-right font-mono">
                      {formatTtbBbl(batch.volume_bbl)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-bold">
                  <TableCell colSpan={3}>Total In Process</TableCell>
                  <TableCell className="text-right font-mono">
                    {formatTtbBbl(batchData.inProgressVolume)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Disclaimer */}
      <Card className="bg-muted/50">
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            <strong>Note:</strong> This report is a summary for internal use and preparation of TTB Form 5130.9.
            The actual form requires additional data including transfers between premises,
            exports documentation, and detailed loss explanations. Consult with your compliance officer
            before filing official reports with the TTB.
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            <strong>Tax Classes:</strong> Kegs (Column C), Canned/Bottled (Column F), Cellar/In-Process (Column A).
            One barrel (BBL) equals 31 gallons per TTB regulations.
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            <strong>Cellar/In-Process:</strong> reported as a current snapshot of
            batches still in fermentation, conditioning, or packaging — it is not a
            period-end balance, and it is the one column the accounting-identity
            checks skip (every other tax class is checked). Record the cellar
            figures for a closed month when you file; re-running the report later
            may show a different snapshot.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
