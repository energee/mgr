"use client";

/**
 * Keg Inventory Page
 *
 * CALCULATED VIEW of keg quantities by type, state, and location.
 * Quantities are derived from keg transactions following the allocations pattern.
 * To modify inventory, record a keg transaction instead.
 */

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Container, Plus, FileText, BarChart3 } from "lucide-react";
import { EntityList } from "@/components/universal/entity-list";
import { kegInventoryEntity } from "@/entities/keg-inventory";

export default function KegInventoryPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/inventory">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Container className="h-6 w-6" />
              Keg Inventory
            </h1>
            <p className="text-muted-foreground">
              Calculated quantities by type, state, and location
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href="/inventory/kegs/reports">
            <Button variant="outline">
              <BarChart3 className="h-4 w-4 mr-2" />
              Reports
            </Button>
          </Link>
          <Link href="/inventory/kegs/transactions">
            <Button variant="outline">
              <FileText className="h-4 w-4 mr-2" />
              Transactions
            </Button>
          </Link>
          <Link href="/inventory/kegs/transactions/new">
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Record Transaction
            </Button>
          </Link>
        </div>
      </div>

      {/* Entity List - no create button since this is a calculated view */}
      <EntityList
        entity={kegInventoryEntity}
        basePath="/inventory/kegs"
        showCreate={false}
      />
    </div>
  );
}
