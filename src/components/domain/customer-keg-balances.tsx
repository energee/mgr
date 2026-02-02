"use client";

/**
 * CustomerKegBalances Component
 *
 * Displays detailed keg balance breakdown by keg type for a customer.
 * Data is calculated from keg_transactions (ship - return = kegs out).
 */

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { kegKeys } from "@/lib/query-keys";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Package, RotateCcw } from "lucide-react";

interface CustomerKegBalance {
  customer_id: string;
  customer_name: string;
  keg_type_id: string;
  keg_type_name: string;
  keg_type_code: string;
  volume_bbl: number;
  deposit_amount: number;
  kegs_out: number;
  deposit_value: number;
}

interface CustomerKegBalancesProps {
  customerId: string;
  showActions?: boolean;
}

export function CustomerKegBalances({
  customerId,
  showActions = true,
}: CustomerKegBalancesProps) {
  const supabase = createClient();

  // Cast supabase to any since customer_keg_balances view isn't in generated types yet
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: balances, isLoading, error } = useQuery({
    queryKey: kegKeys.customerBalances(customerId),
    queryFn: async () => {
      const { data, error } = await db
        .from("customer_keg_balances")
        .select("*")
        .eq("customer_id", customerId)
        .order("keg_type_name");

      if (error) throw error;
      return data as CustomerKegBalance[];
    },
  });

  if (error) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-destructive">
          Failed to load keg balances
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Kegs Out
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const totalKegs = balances?.reduce((sum, b) => sum + b.kegs_out, 0) || 0;
  const totalValue = balances?.reduce((sum, b) => sum + b.deposit_value, 0) || 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Package className="h-5 w-5" />
          Kegs Out
        </CardTitle>
        {showActions && (
          <Button size="sm" variant="outline" asChild>
            <Link
              href={`/inventory/kegs/transactions/new?customer_id=${customerId}&transaction_type=return`}
            >
              <RotateCcw className="h-4 w-4 mr-1" />
              Record Return
            </Link>
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {!balances || balances.length === 0 ? (
          <p className="text-center text-muted-foreground py-4">
            No kegs currently out with this customer
          </p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Keg Type</TableHead>
                  <TableHead className="text-right">Volume</TableHead>
                  <TableHead className="text-right">Kegs Out</TableHead>
                  <TableHead className="text-right">Deposit Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {balances.map((balance) => (
                  <TableRow key={balance.keg_type_id}>
                    <TableCell className="font-medium">
                      {balance.keg_type_name}
                      <span className="text-muted-foreground ml-2 text-sm">
                        ({balance.keg_type_code})
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {balance.volume_bbl} BBL
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {balance.kegs_out}
                    </TableCell>
                    <TableCell className="text-right">
                      ${balance.deposit_value.toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/50 font-semibold">
                  <TableCell colSpan={2}>Total</TableCell>
                  <TableCell className="text-right">{totalKegs}</TableCell>
                  <TableCell className="text-right">
                    ${totalValue.toFixed(2)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <div className="mt-4 text-sm text-muted-foreground">
              <Link
                href={`/inventory/kegs/transactions?customer_id=${customerId}`}
                className="text-primary hover:underline"
              >
                View transaction history
              </Link>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
