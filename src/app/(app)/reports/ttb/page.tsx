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
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { reportKeys } from "@/lib/query-keys";
import { getTaxClassLabel, formatTtbBbl, MONTHS } from "@/domain/ttb-utils";
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
import {
  exportTTBReportToCSV,
  exportBatchDetailsToCSV,
  openTTBPrintView,
  type TTBReportData,
} from "@/lib/report-export";
import { batchEntity } from "@/entities/batch";
import { dynamicRpc } from "@/services/types";
import { getStateLabel } from "@/types/entity";
import { log } from "@/lib/client-logger";

// =============================================================================
// Types
// =============================================================================

type TTBReportRow = {
  report_year: number;
  report_month: number;
  report_period: string;
  ttb_tax_class: string;
  beginning_inventory_bbl: number;
  beer_produced_bbl: number;
  beer_received_bbl: number;
  total_available_bbl: number;
  taxpaid_domestic_bbl: number;
  taxpaid_export_bbl: number;
  tax_free_samples_bbl: number;
  losses_bbl: number;
  destroyed_bbl: number;
  adjustments_bbl: number;
  total_removals_bbl: number;
  ending_inventory_bbl: number;
  in_process_beginning_bbl: number;
  in_process_ending_bbl: number;
}

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

  // Calculate totals from report data
  const totals = reportData?.reduce(
    (acc, row) => ({
      beginningInventory: acc.beginningInventory + (row.beginning_inventory_bbl || 0),
      beerProduced: acc.beerProduced + (row.beer_produced_bbl || 0),
      totalAvailable: acc.totalAvailable + (row.total_available_bbl || 0),
      taxpaidDomestic: acc.taxpaidDomestic + (row.taxpaid_domestic_bbl || 0),
      taxpaidExport: acc.taxpaidExport + (row.taxpaid_export_bbl || 0),
      taxFreeSamples: acc.taxFreeSamples + (row.tax_free_samples_bbl || 0),
      losses: acc.losses + (row.losses_bbl || 0),
      destroyed: acc.destroyed + (row.destroyed_bbl || 0),
      totalRemovals: acc.totalRemovals + (row.total_removals_bbl || 0),
      endingInventory: acc.endingInventory + (row.ending_inventory_bbl || 0),
      inProcessEnding: acc.inProcessEnding + (row.in_process_ending_bbl || 0),
    }),
    {
      beginningInventory: 0,
      beerProduced: 0,
      totalAvailable: 0,
      taxpaidDomestic: 0,
      taxpaidExport: 0,
      taxFreeSamples: 0,
      losses: 0,
      destroyed: 0,
      totalRemovals: 0,
      endingInventory: 0,
      inProcessEnding: 0,
    }
  ) || {
    beginningInventory: 0,
    beerProduced: batchData?.completedVolume || 0,
    totalAvailable: 0,
    taxpaidDomestic: 0,
    taxpaidExport: 0,
    taxFreeSamples: 0,
    losses: 0,
    destroyed: 0,
    totalRemovals: 0,
    endingInventory: 0,
    inProcessEnding: batchData?.inProgressVolume || 0,
  };

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
                openTTBPrintView(reportData as TTBReportData[], totals, year, month);
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
                    exportTTBReportToCSV(reportData as TTBReportData[], year, month);
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
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Beer Produced
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
                  <TableHead className="text-right font-bold">Total</TableHead>
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
                  <TableCell>Beginning Inventory</TableCell>
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
                  <TableCell>Beer Produced/Packaged</TableCell>
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
                  <TableCell className="font-medium">Total Available</TableCell>
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
                  <TableCell>Ending Inventory</TableCell>
                  {reportData.map((row) => (
                    <TableCell key={row.ttb_tax_class} className="text-right font-mono">
                      {formatTtbBbl(row.ending_inventory_bbl)}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-mono">
                    {formatTtbBbl(totals.endingInventory)}
                  </TableCell>
                </TableRow>

                {/* In-Process */}
                <TableRow className="bg-muted/50">
                  <TableCell colSpan={reportData.length + 2} className="font-semibold">
                    Beer in Process (Cellar)
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>End of Month (In Process)</TableCell>
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
                    <TableCell className="pl-6">End of Month</TableCell>
                    <TableCell className="text-right font-mono">
                      {formatTtbBbl(batchData?.inProgressVolume)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
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
        </CardContent>
      </Card>
    </div>
  );
}
