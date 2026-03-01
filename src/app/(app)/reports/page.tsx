/**
 * Reports Index Page
 *
 * Hub for all reporting functionality.
 */

import Link from "next/link";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, ClipboardList, DollarSign, BarChart3 } from "lucide-react";

const reports = [
  {
    title: "TTB Report (Form 5130.9)",
    description: "Brewer's Report of Operations for federal tax compliance",
    href: "/reports/ttb",
    icon: FileText,
  },
  {
    title: "Production Summary",
    description: "Monthly production volumes, brand breakdown, and style analysis",
    href: "/reports/production-summary",
    icon: BarChart3,
  },
  {
    title: "Inventory Valuation",
    description: "Current inventory value by category",
    href: "/reports/inventory-valuation",
    icon: DollarSign,
  },
  {
    title: "Batch Cost Analysis",
    description: "Cost breakdown per batch with ingredient-level detail",
    href: "/reports/batch-cost",
    icon: ClipboardList,
  },
];

export default function ReportsPage() {
  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FileText className="h-6 w-6" />
          Reports
        </h1>
        <p className="text-muted-foreground mt-1">
          Generate compliance reports and business analytics
        </p>
      </div>

      {/* Report Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {reports.map((report) => {
          const Icon = report.icon;
          return (
            <Link key={report.href} href={report.href}>
              <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Icon className="h-5 w-5" />
                    {report.title}
                  </CardTitle>
                  <CardDescription>{report.description}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
