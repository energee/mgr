/**
 * Reports Index Page
 *
 * Hub for all reporting functionality.
 */

import Link from "next/link";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const reports = [
  {
    title: "TTB Report (Form 5130.9)",
    description: "Brewer's Report of Operations for federal tax compliance",
    href: "/reports/ttb",
  },
  {
    title: "Production Summary",
    description: "Monthly production volumes, brand breakdown, and style analysis",
    href: "/reports/production-summary",
  },
  {
    title: "Inventory Valuation",
    description: "Current inventory value by category",
    href: "/reports/inventory-valuation",
  },
  {
    title: "Batch Cost Analysis",
    description: "Cost breakdown per batch with ingredient-level detail",
    href: "/reports/batch-cost",
  },
  {
    title: "Ingredient Projections",
    description: "Forward-looking ingredient needs from orders and batch schedule",
    href: "/reports/projections",
  },
  {
    title: "Cost of Goods Sold",
    description: "COGS analysis by batch, SKU, and time period",
    href: "/reports/cogs",
  },
  {
    title: "Batch Trace",
    description: "Trace a batch from ingredient lots to orders and customers",
    href: "/reports/trace",
  },
];

export default function ReportsPage() {
  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">
          Reports
        </h1>
        <p className="text-muted-foreground mt-1">
          Generate compliance reports and business analytics
        </p>
      </div>

      {/* Report Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {reports.map((report) => (
          <Link key={report.href} href={report.href}>
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
              <CardHeader>
                <CardTitle className="text-base">
                  {report.title}
                </CardTitle>
                <CardDescription>{report.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
