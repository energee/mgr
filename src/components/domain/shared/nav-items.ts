/**
 * Navigation Items
 *
 * Single source of truth for the app's main navigation structure.
 * Consumed by the sidebar (AppSidebar), the cmd+K command palette
 * (CommandPalette), and the mobile bottom tab bar (MobileTabBar)
 * so the three never drift apart.
 *
 * Shape (2026-07-12 mobile-UX spec): direct links + always-open sections.
 * Dashboard and Reports are direct links — their sub-pages are reached via
 * in-page switchers (DashboardSwitcher pills, /reports index), not the nav.
 */

import {
  AnimatedLayoutDashboard,
  AnimatedFlask,
  AnimatedDollarSign,
  AnimatedFileText,
  AnimatedUsers,
  AnimatedClipboardList,
  AnimatedBarChart3,
  AnimatedTruck,
  AnimatedShoppingCart,
  AnimatedTrendingUp,
  AnimatedChartColumn,
  AnimatedPackageCheck,
  AnimatedWarehouse,
  AnimatedBuilding2,
  AnimatedArrowRightLeft,
  AnimatedContainer,
  AnimatedBatches,
  AnimatedUpload,
  AnimatedDownload,
  AnimatedDroplet,
  AnimatedFileStack,
  AnimatedWaypoints,
  AnimatedDrum,
  AnimatedRoute,
  AnimatedShip,
  AnimatedFileCheck,
  AnimatedCheckCheck,
  AnimatedBoxes,
} from "@/components/icons/animated";
import type { AnimatedIconProps } from "@/components/icons/animated";

export type AnimatedIcon = React.ComponentType<AnimatedIconProps>;

export type NavItem = {
  label: string;
  href: string;
  icon: AnimatedIcon;
}

export type NavSection = {
  label: string;
  icon: AnimatedIcon;
  items: NavItem[];
}

/** A top-level nav entry: either a direct link or a section of links. */
export type NavEntry = NavItem | NavSection;

export function isNavSection(entry: NavEntry): entry is NavSection {
  return "items" in entry;
}

export const navigation: NavEntry[] = [
  { label: "Dashboard", href: "/dashboard", icon: AnimatedLayoutDashboard },
  {
    label: "Production",
    icon: AnimatedFlask,
    items: [
      { label: "Batches", href: "/production/batches", icon: AnimatedBatches },
      { label: "Recipes", href: "/production/recipes", icon: AnimatedFileText },
      { label: "Planning", href: "/production/planning", icon: AnimatedCalendarClock },
      { label: "Cellar", href: "/production/cellar", icon: AnimatedWarehouse },
      { label: "Vessels", href: "/production/vessels", icon: AnimatedContainer },
      { label: "Vessel Transfers", href: "/production/vessel-transfers", icon: AnimatedArrowRightLeft },
      { label: "Brew Logs", href: "/production/brew-logs", icon: AnimatedClipboardList },
      { label: "Yeast Pitches", href: "/production/yeast-pitches", icon: AnimatedDroplet },
      { label: "Packaging", href: "/production/packaging", icon: AnimatedPackageCheck },
    ],
  },
  {
    label: "Inventory",
    icon: AnimatedWarehouse,
    items: [
      { label: "Raw Materials", href: "/inventory/items", icon: AnimatedUpload },
      { label: "Finished Goods", href: "/inventory/finished-goods", icon: AnimatedDownload },
      { label: "Lots", href: "/inventory/lots", icon: AnimatedFileStack },
      { label: "Kegs", href: "/inventory/kegs", icon: AnimatedDrum },
      { label: "Bins", href: "/inventory/bins", icon: AnimatedBoxes },
      { label: "Transfers", href: "/inventory/transfers", icon: AnimatedRoute },
      { label: "Allocations", href: "/inventory/allocations", icon: AnimatedWaypoints },
    ],
  },
  {
    label: "Purchasing",
    icon: AnimatedTruck,
    items: [
      { label: "Purchase Orders", href: "/purchasing/pos", icon: AnimatedShoppingCart },
      { label: "Suppliers", href: "/purchasing/suppliers", icon: AnimatedBuilding2 },
      { label: "Material Planning", href: "/purchasing/material-planning", icon: AnimatedChartColumn },
      { label: "Ingredient Demand", href: "/purchasing/demand", icon: AnimatedTrendingUp },
    ],
  },
  {
    label: "Sales",
    icon: AnimatedDollarSign,
    items: [
      { label: "Orders", href: "/sales/orders", icon: AnimatedFileCheck },
      { label: "Pick Lists", href: "/sales/pick-lists", icon: AnimatedCheckCheck },
      { label: "Deliveries", href: "/inventory/deliveries", icon: AnimatedShip },
      { label: "Customers", href: "/sales/customers", icon: AnimatedUsers },
    ],
  },
  { label: "Reports", href: "/reports", icon: AnimatedBarChart3 },
];
