"use client";

/**
 * App Sidebar
 *
 * Main navigation sidebar for the application.
 * Uses shadcn Sidebar components for mobile responsiveness.
 * Animated icons on hover.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useContext, useRef, useState } from "react";
import { usePermissions } from "@/contexts/permissions";
import { AnimatedKeyboard } from "@/components/icons/animated";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { MGRIcon } from "@/components/icons/mgr-logo";
import { KeyboardShortcutsContext } from "@/components/domain/shared/keyboard-shortcuts-provider";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
  AnimatedArrowLeft,
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
import type { AnimatedIconHandle, AnimatedIconProps } from "@/components/icons/animated";

type AnimatedIcon = React.ComponentType<AnimatedIconProps>;

type NavItem = {
  label: string;
  href: string;
  icon: AnimatedIcon;
}

type NavSection = {
  label: string;
  icon: AnimatedIcon;
  items: NavItem[];
}

const navigation: NavSection[] = [
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
      { label: "Planning", href: "/production/planning", icon: AnimatedCalendarClock },
      { label: "Backward Planning", href: "/production/planning/backward", icon: AnimatedArrowLeft },
      { label: "Batches", href: "/production/batches", icon: AnimatedBatches },
      { label: "Recipes", href: "/production/recipes", icon: AnimatedFileText },
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
    ],
  },
];

function AnimatedNavLink({
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
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={isActive}
        onMouseEnter={() => iconRef.current?.startAnimation()}
        onMouseLeave={() => iconRef.current?.stopAnimation()}
      >
        <Link href={href}>
          <Icon ref={iconRef} className="h-4 w-4" />
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function AnimatedSectionHeader({
  section,
}: {
  section: NavSection;
}) {
  const iconRef = useRef<AnimatedIconHandle>(null);
  const chevronRef = useRef<AnimatedIconHandle>(null);

  return (
    <SidebarGroupLabel asChild>
      <CollapsibleTrigger
        className="flex w-full items-center justify-between"
        onMouseEnter={() => {
          iconRef.current?.startAnimation();
          chevronRef.current?.startAnimation();
        }}
        onMouseLeave={() => {
          iconRef.current?.stopAnimation();
          chevronRef.current?.stopAnimation();
        }}
      >
        <span className="flex items-center gap-2">
          <section.icon ref={iconRef} className="h-4 w-4" />
          {section.label}
        </span>
        <AnimatedChevronDown
          ref={chevronRef}
          className="h-4 w-4 transition-transform -rotate-90 group-data-[state=open]/collapsible:rotate-0"
        />
      </CollapsibleTrigger>
    </SidebarGroupLabel>
  );
}

export function AppSidebar() {
  const pathname = usePathname();
  const { can } = usePermissions();
  const { openHelp } = useContext(KeyboardShortcutsContext);
  const keyboardIconRef = useRef<AnimatedIconHandle>(null);
  const activeSection = navigation.find((s) =>
    s.items.some((item) => pathname.startsWith(item.href))
  );
  // Multiple sections can be open at once; start with the active route's section expanded.
  const [openSections, setOpenSections] = useState<Set<string>>(
    () => new Set(activeSection ? [activeSection.label] : [])
  );

  return (
    <Sidebar>
      {/* Logo */}
      <SidebarHeader className="h-12 border-b border-sidebar-border justify-center">
        <div className="flex items-center justify-between px-2">
          <Link href="/" className="flex items-center gap-2">
            <MGRIcon size={20} className="shrink-0" />
            <span className="text-lg font-semibold tracking-tight leading-none translate-y-px">MGR</span>
          </Link>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 hover:bg-transparent hover:text-current"
                onClick={openHelp}
                onMouseEnter={() => keyboardIconRef.current?.startAnimation()}
                onMouseLeave={() => keyboardIconRef.current?.stopAnimation()}
              >
                <AnimatedKeyboard ref={keyboardIconRef} className="h-4 w-4" />
                <span className="sr-only">Keyboard shortcuts</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Keyboard shortcuts</TooltipContent>
          </Tooltip>
        </div>
      </SidebarHeader>

      {/* Navigation */}
      <SidebarContent>
        <nav aria-label="Main navigation">
        {navigation.map((section) => (
          <Collapsible
            key={section.label}
            open={openSections.has(section.label)}
            onOpenChange={(open) =>
              setOpenSections((prev) => {
                const next = new Set(prev);
                if (open) next.add(section.label);
                else next.delete(section.label);
                return next;
              })
            }
            className="group/collapsible"
          >
            <SidebarGroup>
              <AnimatedSectionHeader section={section} />
              <CollapsibleContent>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {section.items.map((item) => (
                      <AnimatedNavLink
                        key={item.href}
                        href={item.href}
                        icon={item.icon}
                        label={item.label}
                        isActive={pathname === item.href || pathname.startsWith(item.href + "/")}
                      />
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>
        ))}
        </nav>
      </SidebarContent>

      {/* Footer */}
      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <AnimatedNavLink
            href="/help"
            icon={AnimatedHelpCircle}
            label="Help"
            isActive={pathname.startsWith("/help")}
          />
          {can("settings:manage") && (
            <AnimatedNavLink
              href="/settings"
              icon={AnimatedSettings}
              label="Settings"
              isActive={pathname.startsWith("/settings")}
            />
          )}
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
