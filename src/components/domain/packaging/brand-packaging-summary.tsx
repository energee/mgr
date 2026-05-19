"use client";

/**
 * Brand Packaging Summary
 *
 * Read-only table showing aggregated packaging totals per selling format
 * for a given brand. Queries the brand_packaging_summary view created
 * in migration 00153.
 */

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { dynamicFrom } from "@/services/types";
import { packagingKeys } from "@/lib/query-keys";
import { unwrap } from "@/lib/supabase/query-helpers";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2 } from "lucide-react";

type BrandPackagingSummaryRow = {
  brand_id: string;
  brand_name: string;
  selling_format_id: string;
  format_name: string;
  total_quantity: number;
  session_count: number;
};

export function BrandPackagingSummary({ brandId }: { brandId: string }) {
  const supabase = createClient();

  const { data: rows, isLoading } = useQuery({
    queryKey: packagingKeys.brandSummary(brandId),
    queryFn: async () => {
      return (await unwrap(
        dynamicFrom(supabase, "brand_packaging_summary")
          .select("*")
          .eq("brand_id", brandId),
      ) ?? []) as unknown as BrandPackagingSummaryRow[];
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!rows?.length) {
    return null;
  }

  return (
    <div className="rounded-lg border bg-card">
      <div className="border-b px-4 py-3">
        <h3 className="text-sm font-medium">Packaging Production</h3>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Format</TableHead>
            <TableHead className="text-right">Total Quantity</TableHead>
            <TableHead className="text-right">Sessions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.selling_format_id}>
              <TableCell>{row.format_name}</TableCell>
              <TableCell className="text-right">
                {row.total_quantity.toLocaleString()}
              </TableCell>
              <TableCell className="text-right">
                {row.session_count}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
