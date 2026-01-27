"use client";

/**
 * App Sidebar
 *
 * Main navigation sidebar for the application.
 * Organized by domain: Production, Packaging, Inventory, Purchasing, Sales.
 *
 * Design: Rich dark sidebar with warm copper accents
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Beaker,
  Warehouse,
  DollarSign,
  Settings,
  LayoutDashboard,
  FlaskConical,
  FileText,
  BoxesIcon,
  Users,
  ChevronDown,
  Container,
  ClipboardList,
  BarChart3,
  Package,
  Truck,
  Building2,
  ShoppingCart,
  ArrowRightLeft,
  PackageCheck,
  CalendarClock,
  TrendingUp,
} from "lucide-react";
import { useState } from "react";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavSection {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  items: NavItem[];
}

const navigation: NavSection[] = [
  {
    label: "Dashboards",
    icon: LayoutDashboard,
    items: [
      { label: "Production", href: "/dashboard", icon: FlaskConical },
      { label: "Inventory", href: "/dashboard/inventory", icon: Package },
      { label: "Sales", href: "/dashboard/sales", icon: DollarSign },
    ],
  },
  {
    label: "Production",
    icon: Beaker,
    items: [
      { label: "Planning", href: "/production/planning", icon: CalendarClock },
      { label: "Batches", href: "/production/batches", icon: FlaskConical },
      { label: "Recipes", href: "/production/recipes", icon: FileText },
      { label: "Vessels", href: "/production/vessels", icon: Container },
      { label: "Vessel Transfers", href: "/production/vessel-transfers", icon: ArrowRightLeft },
      { label: "Brew Logs", href: "/production/brew-logs", icon: ClipboardList },
      { label: "Yeast Pitches", href: "/production/yeast-pitches", icon: Beaker },
    ],
  },
  {
    label: "Packaging",
    icon: PackageCheck,
    items: [
      { label: "Sessions", href: "/production/packaging", icon: Package },
      { label: "Finished Goods", href: "/inventory/finished-goods", icon: BoxesIcon },
    ],
  },
  {
    label: "Inventory",
    icon: Warehouse,
    items: [
      { label: "Items", href: "/inventory/items", icon: BoxesIcon },
    ],
  },
  {
    label: "Purchasing",
    icon: Truck,
    items: [
      { label: "Ingredient Demand", href: "/purchasing/demand", icon: TrendingUp },
      { label: "Suppliers", href: "/purchasing/suppliers", icon: Building2 },
      { label: "Purchase Orders", href: "/purchasing/pos", icon: ShoppingCart },
    ],
  },
  {
    label: "Sales",
    icon: DollarSign,
    items: [
      { label: "Orders", href: "/sales/orders", icon: FileText },
      { label: "Customers", href: "/sales/customers", icon: Users },
    ],
  },
  {
    label: "Reports",
    icon: BarChart3,
    items: [
      { label: "All Reports", href: "/reports", icon: FileText },
      { label: "TTB Report", href: "/reports/ttb", icon: ClipboardList },
    ],
  },
];

export function AppSidebar() {
  const pathname = usePathname();
  const [expandedSections, setExpandedSections] = useState<string[]>(
    // Expand section that contains current path
    navigation
      .filter((section) => section.items.some((item) => pathname.startsWith(item.href)))
      .map((section) => section.label)
  );

  const toggleSection = (label: string) => {
    setExpandedSections((prev) =>
      prev.includes(label)
        ? prev.filter((l) => l !== label)
        : [...prev, label]
    );
  };

  return (
    <aside className="w-64 bg-sidebar text-sidebar-foreground flex flex-col border-r border-sidebar-border">
      {/* Logo */}
      <div className="h-16 flex items-center px-6 border-b border-sidebar-border">
        <Link href="/" className="flex items-center gap-2 group">
          <div className="w-8 h-8 rounded-md bg-sidebar-primary flex items-center justify-center">
            <span className="text-sidebar-primary-foreground font-bold text-sm">M</span>
          </div>
          <span className="text-lg font-semibold tracking-tight">MGR</span>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navigation.map((section) => {
          const isExpanded = expandedSections.includes(section.label);
          const isActive = section.items.some((item) => pathname.startsWith(item.href));

          return (
            <div key={section.label} className="mt-3 first:mt-0">
              <button
                onClick={() => toggleSection(section.label)}
                className={cn(
                  "flex items-center justify-between w-full px-3 py-2 rounded-md text-sm font-medium transition-all duration-200",
                  isActive
                    ? "text-sidebar-foreground"
                    : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent"
                )}
              >
                <span className="flex items-center gap-3">
                  <section.icon className={cn(
                    "h-4 w-4 transition-colors",
                    isActive && "text-sidebar-primary"
                  )} />
                  {section.label}
                </span>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 transition-transform duration-200",
                    isExpanded && "rotate-180"
                  )}
                />
              </button>

              {isExpanded && (
                <div className="mt-1 ml-3 pl-4 border-l border-sidebar-border/50 space-y-0.5">
                  {section.items.map((item) => {
                    const isItemActive = pathname === item.href || pathname.startsWith(item.href + "/");
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-all duration-200",
                          isItemActive
                            ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium"
                            : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent"
                        )}
                      >
                        <item.icon className="h-4 w-4" />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Settings */}
      <div className="px-3 py-4 border-t border-sidebar-border">
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all duration-200",
            pathname.startsWith("/settings")
              ? "bg-sidebar-primary text-sidebar-primary-foreground"
              : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent"
          )}
        >
          <Settings className="h-4 w-4" />
          Settings
        </Link>
      </div>
    </aside>
  );
}
