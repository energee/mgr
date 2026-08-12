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
 *
 * Frozen-out surfaces (2.0 streamlining, node D3). These features keep their
 * code, routes and migrations — they are simply not advertised in the primary
 * nav, and must not be re-added here without an explicit product decision:
 *
 * - QuickBooks Online     — reachable via /settings/integrations
 * - Slack notifications   — reachable via /settings/integrations
 * - Beer-orders XLSX      — reachable via /settings/integrations/beer-orders
 * - Keg owner/deposits    — reachable via the /inventory/kegs page links
 *   (keg FILL identity — `keg_filled_contents` netting in packaging and
 *   fulfilment — is a separate, live concern and is unaffected)
 * - Inventory/Sales dashboards — reachable via the DashboardSwitcher pills
 *
 * Square POS is deliberately NOT frozen. Pick lists are deliberately NOT
 * frozen (their completion transitions allocations) and stay under Sales.
 * `nav-items.test.ts` pins this list so a regression fails the suite.
 */

import {
  ArrowRight,
  Boxes,
  ChartBarIncreasing,
  ChartColumnIncreasing,
  CheckCheck,
  CircleCheck,
  ClipboardCheck,
  DollarSign,
  Droplet,
  Drum,
  FileCheck,
  FileStack,
  FileText,
  FlaskConical,
  HardDriveDownload,
  HardDriveUpload,
  Home,
  LayoutPanelTop,
  Route,
  Ship,
  ShoppingCart,
  SquareStack,
  TrendingUp,
  Truck,
  Users,
  Waves,
  Waypoints,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type NavIcon = LucideIcon;

export type NavItem = {
  label: string;
  href: string;
  icon: NavIcon;
}

export type NavSection = {
  label: string;
  icon: NavIcon;
  items: NavItem[];
}

/** A top-level nav entry: either a direct link or a section of links. */
export type NavEntry = NavItem | NavSection;

export function isNavSection(entry: NavEntry): entry is NavSection {
  return "items" in entry;
}

export const navigation: NavEntry[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutPanelTop },
  {
    label: "Production",
    icon: FlaskConical,
    items: [
      { label: "Batches", href: "/production/batches", icon: Waves },
      { label: "Recipes", href: "/production/recipes", icon: FileText },
      { label: "Cellar", href: "/production/cellar", icon: Boxes },
      { label: "Vessels", href: "/production/vessels", icon: SquareStack },
      { label: "Vessel Transfers", href: "/production/vessel-transfers", icon: ArrowRight },
      { label: "Brew Logs", href: "/production/brew-logs", icon: ClipboardCheck },
      { label: "Yeast Pitches", href: "/production/yeast-pitches", icon: Droplet },
      { label: "Packaging", href: "/production/packaging", icon: CircleCheck },
    ],
  },
  {
    label: "Inventory",
    icon: Boxes,
    items: [
      { label: "Raw Materials", href: "/inventory/items", icon: HardDriveUpload },
      { label: "Finished Goods", href: "/inventory/finished-goods", icon: HardDriveDownload },
      { label: "Lots", href: "/inventory/lots", icon: FileStack },
      { label: "Kegs", href: "/inventory/kegs", icon: Drum },
      { label: "Bins", href: "/inventory/bins", icon: Boxes },
      { label: "Transfers", href: "/inventory/transfers", icon: Route },
      { label: "Allocations", href: "/inventory/allocations", icon: Waypoints },
    ],
  },
  {
    label: "Purchasing",
    icon: Truck,
    items: [
      { label: "Purchase Orders", href: "/purchasing/pos", icon: ShoppingCart },
      { label: "Suppliers", href: "/purchasing/suppliers", icon: Home },
      { label: "Material Planning", href: "/purchasing/material-planning", icon: ChartColumnIncreasing },
      { label: "Ingredient Demand", href: "/purchasing/demand", icon: TrendingUp },
    ],
  },
  {
    label: "Sales",
    icon: DollarSign,
    items: [
      { label: "Orders", href: "/sales/orders", icon: FileCheck },
      { label: "Pick Lists", href: "/sales/pick-lists", icon: CheckCheck },
      { label: "Deliveries", href: "/inventory/deliveries", icon: Ship },
      { label: "Customers", href: "/sales/customers", icon: Users },
    ],
  },
  { label: "Reports", href: "/reports", icon: ChartBarIncreasing },
];
