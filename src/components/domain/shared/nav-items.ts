/**
 * Navigation Items
 *
 * Single source of truth for the app's main navigation structure.
 * Consumed by both the sidebar (AppSidebar) and the cmd+K command
 * palette (CommandPalette) so the two never drift apart.
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
  AnimatedPackage,
  AnimatedPackageCheck,
  AnimatedWarehouse,
  AnimatedBuilding2,
  AnimatedArrowRightLeft,
  AnimatedContainer,
  AnimatedBatches,
  AnimatedUpload,
  AnimatedDownload,
  AnimatedGauge,
  AnimatedChartLine,
  AnimatedDroplet,
  AnimatedLayers,
  AnimatedFileStack,
  AnimatedWaypoints,
  AnimatedDrum,
  AnimatedRoute,
  AnimatedShip,
  AnimatedFileCheck,
  AnimatedCheckCheck,
  AnimatedFolderOpen,
  AnimatedShieldCheck,
  AnimatedChartColumn,
  AnimatedHandCoins,
  AnimatedCircleDollarSign,
  AnimatedTelescope,
  AnimatedCog,
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

export const navigation: NavSection[] = [
  {
    label: "Dashboards",
    icon: AnimatedLayoutDashboard,
    items: [
      { label: "Production", href: "/dashboard", icon: AnimatedGauge },
      { label: "Inventory", href: "/dashboard/inventory", icon: AnimatedPackage },
      { label: "Sales", href: "/dashboard/sales", icon: AnimatedChartLine },
    ],
  },
  {
    label: "Production",
    icon: AnimatedFlask,
    items: [
      { label: "Batches", href: "/production/batches", icon: AnimatedBatches },
      { label: "Recipes", href: "/production/recipes", icon: AnimatedFileText },
      { label: "Cellar", href: "/production/cellar", icon: AnimatedWarehouse },
      { label: "Vessels", href: "/production/vessels", icon: AnimatedContainer },
      { label: "Vessel Transfers", href: "/production/vessel-transfers", icon: AnimatedArrowRightLeft },
      { label: "Brew Logs", href: "/production/brew-logs", icon: AnimatedClipboardList },
      { label: "Yeast Pitches", href: "/production/yeast-pitches", icon: AnimatedDroplet },
    ],
  },
  {
    label: "Packaging",
    icon: AnimatedPackageCheck,
    items: [
      { label: "Sessions", href: "/production/packaging", icon: AnimatedLayers },
    ],
  },
  {
    label: "Inventory",
    icon: AnimatedWarehouse,
    items: [
      { label: "Raw Materials", href: "/inventory/items", icon: AnimatedUpload },
      { label: "Finished Goods", href: "/inventory/finished-goods", icon: AnimatedDownload },
      { label: "Lots", href: "/inventory/lots", icon: AnimatedFileStack },
      { label: "Allocations", href: "/inventory/allocations", icon: AnimatedWaypoints },
      { label: "Kegs", href: "/inventory/kegs", icon: AnimatedDrum },
      { label: "Bins", href: "/inventory/bins", icon: AnimatedBoxes },
      { label: "Transfers", href: "/inventory/transfers", icon: AnimatedRoute },
    ],
  },
  {
    label: "Purchasing",
    icon: AnimatedTruck,
    items: [
      { label: "Material Planning", href: "/purchasing/material-planning", icon: AnimatedChartColumn },
      { label: "Ingredient Demand", href: "/purchasing/demand", icon: AnimatedTrendingUp },
      { label: "Suppliers", href: "/purchasing/suppliers", icon: AnimatedBuilding2 },
      { label: "Purchase Orders", href: "/purchasing/pos", icon: AnimatedShoppingCart },
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
  {
    label: "Reports",
    icon: AnimatedBarChart3,
    items: [
      { label: "All Reports", href: "/reports", icon: AnimatedFolderOpen },
      { label: "TTB Report", href: "/reports/ttb", icon: AnimatedShieldCheck },
      { label: "Production Summary", href: "/reports/production-summary", icon: AnimatedChartColumn },
      { label: "Inventory Valuation", href: "/reports/inventory-valuation", icon: AnimatedHandCoins },
      { label: "Batch Cost", href: "/reports/batch-cost", icon: AnimatedCircleDollarSign },
      { label: "Projections", href: "/reports/projections", icon: AnimatedTelescope },
      { label: "COGS", href: "/reports/cogs", icon: AnimatedCog },
      { label: "Batch Trace", href: "/reports/trace", icon: AnimatedRoute },
    ],
  },
];
