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
  AnimatedLayoutDashboard,
  AnimatedFlask,
  AnimatedDollarSign,
  AnimatedSettings,
  AnimatedHelpCircle,
  AnimatedFileText,
  AnimatedUsers,
  AnimatedChevronDown,
  AnimatedClipboardList,
  AnimatedBarChart3,
  AnimatedTruck,
  AnimatedShoppingCart,
  AnimatedTrendingUp,
  AnimatedPackage,
  AnimatedPackageCheck,
  AnimatedWarehouse,
  AnimatedBuilding2,
  AnimatedCalendarClock,
  AnimatedArrowRightLeft,
  AnimatedContainer,
  AnimatedBatches,
  AnimatedUpload,
  AnimatedDownload,
} from "@/components/icons/animated";
import type { AnimatedIconHandle, AnimatedIconProps } from "@/components/icons/animated";
import { useRef, useState } from "react";

type AnimatedIcon = React.ComponentType<AnimatedIconProps>;

interface NavItem {
  label: string;
  href: string;
  icon: AnimatedIcon;
}

interface NavSection {
  label: string;
  icon: AnimatedIcon;
  items: NavItem[];
}

function NavSectionHeader({
  section,
  isActive,
  isExpanded,
  onToggle,
}: {
  section: NavSection;
  isActive: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const iconRef = useRef<AnimatedIconHandle>(null);
  const chevronRef = useRef<AnimatedIconHandle>(null);

  return (
    <button
      onClick={onToggle}
      onMouseEnter={() => {
        iconRef.current?.startAnimation();
        chevronRef.current?.startAnimation();
      }}
      onMouseLeave={() => {
        iconRef.current?.stopAnimation();
        chevronRef.current?.stopAnimation();
      }}
      className={cn(
        "flex items-center justify-between w-full px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-200",
        isActive
          ? "text-sidebar-foreground"
          : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent"
      )}
    >
      <span className="flex items-center gap-3">
        <section.icon
          ref={iconRef}
          className={cn(
            "h-4 w-4 transition-colors",
            isActive && "text-sidebar-primary"
          )}
        />
        {section.label}
      </span>
      <AnimatedChevronDown
        ref={chevronRef}
        className={cn(
          "h-4 w-4 transition-transform duration-200",
          isExpanded && "rotate-180"
        )}
      />
    </button>
  );
}

function NavItemLink({
  item,
  isActive,
}: {
  item: NavItem;
  isActive: boolean;
}) {
  const iconRef = useRef<AnimatedIconHandle>(null);

  return (
    <Link
      href={item.href}
      onMouseEnter={() => iconRef.current?.startAnimation()}
      onMouseLeave={() => iconRef.current?.stopAnimation()}
      className={cn(
        "flex items-center gap-3 px-3 py-1 rounded-md text-sm transition-all duration-200",
        isActive
          ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium"
          : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent"
      )}
    >
      <item.icon ref={iconRef} className="h-4 w-4" />
      {item.label}
    </Link>
  );
}

function FooterLink({
  href,
  icon: Icon,
  label,
  isActive,
}: {
  href: string;
  icon: AnimatedIcon;
  label: string;
  isActive: boolean;
}) {
  const iconRef = useRef<AnimatedIconHandle>(null);

  return (
    <Link
      href={href}
      onMouseEnter={() => iconRef.current?.startAnimation()}
      onMouseLeave={() => iconRef.current?.stopAnimation()}
      className={cn(
        "flex items-center gap-3 px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-200",
        isActive
          ? "bg-sidebar-primary text-sidebar-primary-foreground"
          : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent"
      )}
    >
      <Icon ref={iconRef} className="h-4 w-4" />
      {label}
    </Link>
  );
}

const navigation: NavSection[] = [
  {
    label: "Dashboards",
    icon: AnimatedLayoutDashboard,
    items: [
      { label: "Production", href: "/dashboard", icon: AnimatedFlask },
      { label: "Inventory", href: "/dashboard/inventory", icon: AnimatedPackage },
      { label: "Sales", href: "/dashboard/sales", icon: AnimatedDollarSign },
    ],
  },
  {
    label: "Production",
    icon: AnimatedFlask,
    items: [
      { label: "Planning", href: "/production/planning", icon: AnimatedCalendarClock },
      { label: "Batches", href: "/production/batches", icon: AnimatedBatches },
      { label: "Recipes", href: "/production/recipes", icon: AnimatedFileText },
      { label: "Vessels", href: "/production/vessels", icon: AnimatedContainer },
      { label: "Vessel Transfers", href: "/production/vessel-transfers", icon: AnimatedArrowRightLeft },
      { label: "Brew Logs", href: "/production/brew-logs", icon: AnimatedClipboardList },
      { label: "Yeast Pitches", href: "/production/yeast-pitches", icon: AnimatedFlask },
    ],
  },
  {
    label: "Packaging",
    icon: AnimatedPackageCheck,
    items: [
      { label: "Sessions", href: "/production/packaging", icon: AnimatedPackage },
    ],
  },
  {
    label: "Inventory",
    icon: AnimatedWarehouse,
    items: [
      { label: "Raw Materials", href: "/inventory/items", icon: AnimatedUpload },
      { label: "Finished Goods", href: "/inventory/finished-goods", icon: AnimatedDownload },
    ],
  },
  {
    label: "Purchasing",
    icon: AnimatedTruck,
    items: [
      { label: "Ingredient Demand", href: "/purchasing/demand", icon: AnimatedTrendingUp },
      { label: "Suppliers", href: "/purchasing/suppliers", icon: AnimatedBuilding2 },
      { label: "Purchase Orders", href: "/purchasing/pos", icon: AnimatedShoppingCart },
    ],
  },
  {
    label: "Sales",
    icon: AnimatedDollarSign,
    items: [
      { label: "Orders", href: "/sales/orders", icon: AnimatedFileText },
      { label: "Pick Lists", href: "/sales/pick-lists", icon: AnimatedClipboardList },
      { label: "Customers", href: "/sales/customers", icon: AnimatedUsers },
    ],
  },
  {
    label: "Reports",
    icon: AnimatedBarChart3,
    items: [
      { label: "All Reports", href: "/reports", icon: AnimatedFileText },
      { label: "TTB Report", href: "/reports/ttb", icon: AnimatedClipboardList },
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
      <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
        {navigation.map((section) => {
          const isExpanded = expandedSections.includes(section.label);
          const isActive = section.items.some((item) => pathname.startsWith(item.href));

          return (
            <div key={section.label} className="mt-1 first:mt-0">
              <NavSectionHeader
                section={section}
                isActive={isActive}
                isExpanded={isExpanded}
                onToggle={() => toggleSection(section.label)}
              />

              {isExpanded && (
                <div className="mt-1 ml-3 pl-4 border-l border-sidebar-border/50">
                  {section.items.map((item) => {
                    const isItemActive = pathname === item.href || pathname.startsWith(item.href + "/");
                    return (
                      <NavItemLink
                        key={item.href}
                        item={item}
                        isActive={isItemActive}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer links */}
      <div className="px-3 py-3 border-t border-sidebar-border">
        <FooterLink
          href="/help"
          icon={AnimatedHelpCircle}
          label="Help"
          isActive={pathname.startsWith("/help")}
        />
        <FooterLink
          href="/settings"
          icon={AnimatedSettings}
          label="Settings"
          isActive={pathname.startsWith("/settings")}
        />
      </div>
    </aside>
  );
}
