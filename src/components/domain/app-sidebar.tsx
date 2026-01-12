"use client";

/**
 * App Sidebar
 *
 * Main navigation sidebar for the application.
 * Organized by domain: Production, Packaging, Inventory, Purchasing, Sales.
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
  Truck,
  Building2,
  BarChart3,
  Package,
  Truck,
  Building2,
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
    ],
  },
  {
    label: "Production",
    icon: Beaker,
    items: [
      { label: "Batches", href: "/production/batches", icon: FlaskConical },
      { label: "Recipes", href: "/production/recipes", icon: FileText },
      { label: "Vessels", href: "/production/vessels", icon: Container },
      { label: "Brew Logs", href: "/production/brew-logs", icon: ClipboardList },
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
      { label: "Suppliers", href: "/purchasing/suppliers", icon: Building2 },
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
    <aside className="w-64 border-r bg-card flex flex-col">
      {/* Logo */}
      <div className="h-16 flex items-center px-6 border-b">
        <Link href="/" className="text-xl font-bold">
          MGR
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {/* Home */}
        <Link
          href="/dashboard"
          className={cn(
            "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
            pathname === "/" || pathname === "/dashboard"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          <LayoutDashboard className="h-4 w-4" />
          Home
        </Link>

        {/* Sections */}
        {navigation.map((section) => {
          const isExpanded = expandedSections.includes(section.label);
          const isActive = section.items.some((item) => pathname.startsWith(item.href));

          return (
            <div key={section.label} className="mt-4">
              <button
                onClick={() => toggleSection(section.label)}
                className={cn(
                  "flex items-center justify-between w-full px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  isActive
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <span className="flex items-center gap-3">
                  <section.icon className="h-4 w-4" />
                  {section.label}
                </span>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 transition-transform",
                    isExpanded && "rotate-180"
                  )}
                />
              </button>

              {isExpanded && (
                <div className="mt-1 ml-4 pl-4 border-l space-y-1">
                  {section.items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                        pathname === item.href || pathname.startsWith(item.href + "/")
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                      {item.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Settings */}
      <div className="p-4 border-t">
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
            pathname.startsWith("/settings")
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          <Settings className="h-4 w-4" />
          Settings
        </Link>
      </div>
    </aside>
  );
}
