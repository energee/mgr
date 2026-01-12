"use client";

/**
 * TTB Report Page (Form 5130.9)
 *
 * Brewer's Report of Operations for federal tax compliance.
 * Calculates production volumes by tax class for the reporting period.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, FileText, Download, Printer, Calendar } from "lucide-react";
import Link from "next/link";

// =============================================================================
// Types
// =============================================================================

interface TTBData {
  // Production data
  beerProducedBbl: number;
  beerPackagedBbl: number;
  // On premises
  onPremisesBbl: number;
  // In bond
  inBondBeginning: number;
  inBondEnding: number;
  // Removals
  taxpaidRemovalBbl: number;
  taxDeterminedBbl: number;
  // Losses
  lossesBbl: number;
}

interface BatchSummary {
  id: string;
  batch_number: string;
  name: string;
  status: string;
  volume_bbl: number | null;
  updated_at: string | null;
}

// =============================================================================
// Helper Functions
// =============================================================================

function getMonthDateRange(year: number, month: number): { start: string; end: string } {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  return {
    start: start.toISOString().split("T")[0],
    end: end.toISOString().split("T")[0],
  };
}

function formatBbl(value: number): string {
  return value.toFixed(2);
}

// =============================================================================
// Component
// =============================================================================

export default function TTBReportPage() {
  const supabase = createClient();
  const currentDate = new Date();
  const [year, setYear] = useState(currentDate.getFullYear());
  const [month, setMonth] = useState(currentDate.getMonth() + 1);

  const dateRange = getMonthDateRange(year, month);

  // Fetch batch data for the period
  const { data: batchData, isLoading } = useQuery({
    queryKey: ["ttb-report", year, month],
    queryFn: async () => {
      // Batches completed in the period
      const { data: completedBatches, error: completedError } = await supabase
        .from("batches")
        .select("id, batch_number, name, status, volume_bbl, updated_at")
        .eq("status", "completed")
        .gte("updated_at", dateRange.start)
        .lte("updated_at", dateRange.end + "T23:59:59Z");

      if (completedError) throw completedError;

      // Batches in production (fermenting, conditioning, packaging)
      const { data: inProgressBatches, error: inProgressError } = await supabase
        .from("batches")
        .select("id, batch_number, name, status, volume_bbl")
        .in("status", ["fermenting", "conditioning", "packaging"]);

      if (inProgressError) throw inProgressError;

      // Calculate totals
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

  // Calculate TTB report values
  const ttbData: TTBData = {
    beerProducedBbl: batchData?.completedVolume || 0,
    beerPackagedBbl: batchData?.completedVolume || 0, // Simplified: assume all completed = packaged
    onPremisesBbl: 0, // Would need taproom tracking
    inBondBeginning: 0, // Would need prior period data
    inBondEnding: batchData?.inProgressVolume || 0,
    taxpaidRemovalBbl: batchData?.completedVolume || 0, // Simplified
    taxDeterminedBbl: batchData?.completedVolume || 0,
    lossesBbl: 0, // Would need loss tracking
  };

  const monthName = new Date(year, month - 1).toLocaleString("default", { month: "long" });

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/reports">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="h-6 w-6" />
            TTB Report (Form 5130.9)
          </h1>
          <p className="text-muted-foreground">
            Brewer&apos;s Report of Operations
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled>
            <Printer className="h-4 w-4 mr-2" />
            Print
          </Button>
          <Button variant="outline" size="sm" disabled>
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
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
              <Input
                type="number"
                value={year}
                onChange={(e) => setYear(parseInt(e.target.value) || currentDate.getFullYear())}
                className="w-24"
                min={2020}
                max={currentDate.getFullYear()}
              />
            </div>
            <div className="space-y-2">
              <Label>Month</Label>
              <Input
                type="number"
                value={month}
                onChange={(e) => setMonth(Math.min(12, Math.max(1, parseInt(e.target.value) || 1)))}
                className="w-20"
                min={1}
                max={12}
              />
            </div>
            <div className="pb-2 text-muted-foreground">
              {monthName} {year}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Report Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Report Summary</CardTitle>
          <CardDescription>
            Data for TTB Form 5130.9 - {monthName} {year}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading report data...
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
                    {formatBbl(ttbData.beerProducedBbl)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="pl-6">Beer Packaged</TableCell>
                  <TableCell className="text-right font-mono">
                    {formatBbl(ttbData.beerPackagedBbl)}
                  </TableCell>
                </TableRow>

                <TableRow>
                  <TableCell className="font-medium pt-4">
                    Part II - Beer in Process
                  </TableCell>
                  <TableCell></TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="pl-6">Beginning of Month</TableCell>
                  <TableCell className="text-right font-mono">
                    {formatBbl(ttbData.inBondBeginning)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="pl-6">End of Month</TableCell>
                  <TableCell className="text-right font-mono">
                    {formatBbl(ttbData.inBondEnding)}
                  </TableCell>
                </TableRow>

                <TableRow>
                  <TableCell className="font-medium pt-4">
                    Part III - Disposition of Beer
                  </TableCell>
                  <TableCell></TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="pl-6">Taxpaid Removals</TableCell>
                  <TableCell className="text-right font-mono">
                    {formatBbl(ttbData.taxpaidRemovalBbl)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="pl-6">Tax Determined</TableCell>
                  <TableCell className="text-right font-mono">
                    {formatBbl(ttbData.taxDeterminedBbl)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="pl-6">Losses</TableCell>
                  <TableCell className="text-right font-mono">
                    {formatBbl(ttbData.lossesBbl)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Batch Detail */}
      <Card>
        <CardHeader>
          <CardTitle>Completed Batches in Period</CardTitle>
          <CardDescription>
            Batches that completed during {monthName} {year}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {batchData?.completedBatches.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">
              No batches completed in this period
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch #</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Volume (BBL)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batchData?.completedBatches.map((batch: BatchSummary) => (
                  <TableRow key={batch.id}>
                    <TableCell className="font-mono">{batch.batch_number}</TableCell>
                    <TableCell>{batch.name}</TableCell>
                    <TableCell className="text-right font-mono">
                      {formatBbl(batch.volume_bbl || 0)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-bold">
                  <TableCell colSpan={2}>Total</TableCell>
                  <TableCell className="text-right font-mono">
                    {formatBbl(batchData?.completedVolume || 0)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Disclaimer */}
      <Card className="bg-muted/50">
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            <strong>Note:</strong> This report is a simplified summary for internal use.
            The actual TTB Form 5130.9 requires additional data including transfers,
            exports, and detailed loss tracking. Consult with your compliance officer
            before filing official reports.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
