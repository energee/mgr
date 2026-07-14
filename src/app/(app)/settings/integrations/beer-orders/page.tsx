/** Settings page for uploading and reconciling Beer Orders spreadsheets. */

import Link from "next/link";
import { ArrowLeft, FileSpreadsheet } from "lucide-react";
import { BeerOrderSyncPanel } from "@/components/domain/beer-orders/beer-order-sync-panel";
import { Button } from "@/components/ui/button";

export default function BeerOrdersIntegrationPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/settings/integrations" aria-label="Back to integrations">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex items-center gap-3">
          <FileSpreadsheet className="h-6 w-6" />
          <div>
            <h1 className="text-2xl font-semibold">Beer Orders Spreadsheet</h1>
            <p className="text-sm text-muted-foreground">
              Preview and reconcile distributor orders from Excel
            </p>
          </div>
        </div>
      </div>
      <BeerOrderSyncPanel />
    </div>
  );
}
