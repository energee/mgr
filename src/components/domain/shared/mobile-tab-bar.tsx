"use client";

/**
 * MobileTabBar — fixed bottom navigation on phones (<md).
 *
 * Three primary floor-workflow destinations (brewhouse + warehouse personas,
 * 2026-07-12 mobile-UX spec) plus "More", which opens the full nav in the
 * shadcn sidebar's mobile sheet. Hidden on md+ where the sidebar is visible.
 * z-40 sits under the mobile filter sheet (z-50) and over the FAB (z-30).
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FlaskConical, Warehouse, ClipboardCheck, Menu } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

const TABS = [
  { label: "Batches", href: "/production/batches", icon: FlaskConical },
  { label: "Inventory", href: "/inventory/items", icon: Warehouse },
  { label: "Picks", href: "/sales/pick-lists", icon: ClipboardCheck },
] as const;

/** Active when the path is the tab target or nested under it. Exported for tests. */
export function isTabActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

export function MobileTabBar() {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();

  const itemClass =
    "flex min-h-14 flex-col items-center justify-center gap-1 text-xs";

  return (
    <nav
      aria-label="Primary"
      className="bg-background fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {TABS.map((tab) => {
        const active = isTabActive(pathname, tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(itemClass, active ? "text-foreground font-medium" : "text-muted-foreground")}
          >
            <tab.icon className="h-5 w-5" aria-hidden="true" />
            {tab.label}
          </Link>
        );
      })}
      <button
        type="button"
        onClick={() => setOpenMobile(true)}
        className={cn(itemClass, "text-muted-foreground")}
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
        More
      </button>
    </nav>
  );
}
