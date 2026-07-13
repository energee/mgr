"use client";

/**
 * DashboardSwitcher — link pills between the three dashboards.
 *
 * The nav has a single "Dashboard" entry (2026-07-12 mobile-UX spec);
 * Inventory and Sales dashboards are reached through these pills instead
 * of dedicated sidebar links. Same visual pattern as the Production
 * Planning page's Shortfalls/Orders/Timeline switcher.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const DASHBOARDS = [
  { label: "Production", href: "/dashboard" },
  { label: "Inventory", href: "/dashboard/inventory" },
  { label: "Sales", href: "/dashboard/sales" },
] as const;

export function DashboardSwitcher() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Dashboards"
      className="bg-muted flex w-fit items-center gap-1 rounded-lg p-0.5 text-sm"
    >
      {DASHBOARDS.map((d) => {
        const active = pathname === d.href;
        return (
          <Link
            key={d.href}
            href={d.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex min-h-7 items-center rounded-md px-3",
              active
                ? "bg-background shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {d.label}
          </Link>
        );
      })}
    </nav>
  );
}
