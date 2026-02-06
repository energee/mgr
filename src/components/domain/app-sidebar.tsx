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
import { AnimatedKeyboard } from "@/components/icons/animated";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { MGRIcon } from "@/components/icons/mgr-logo";
import { KeyboardShortcutsContext } from "@/components/domain/keyboard-shortcuts-provider";
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
} from "@/components/icons/animated";
import type { AnimatedIconHandle, AnimatedIconProps } from "@/components/icons/animated";

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
      { label: "Backward Planning", href: "/production/planning/backward", icon: AnimatedArrowLeft },
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
      { label: "Lots", href: "/inventory/lots", icon: AnimatedPackage },
      { label: "Allocations", href: "/inventory/allocations", icon: AnimatedArrowRightLeft },
      { label: "Kegs", href: "/inventory/kegs", icon: AnimatedContainer },
      { label: "Bins", href: "/inventory/bins", icon: AnimatedWarehouse },
      { label: "Transfers", href: "/inventory/transfers", icon: AnimatedArrowRightLeft },
      { label: "Deliveries", href: "/inventory/deliveries", icon: AnimatedTruck },
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

function AnimatedNavItem({
  item,
  isActive,
}: {
  item: NavItem;
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
        <Link href={item.href}>
          <item.icon ref={iconRef} className="h-4 w-4" />
          <span>{item.label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function AnimatedFooterItem({
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
  const { openHelp } = useContext(KeyboardShortcutsContext);
  const keyboardIconRef = useRef<AnimatedIconHandle>(null);
  const activeSection = navigation.find((s) =>
    s.items.some((item) => pathname.startsWith(item.href))
  );
  const [openSection, setOpenSection] = useState<string | null>(
    activeSection?.label ?? null
  );

  return (
    <Sidebar>
      {/* Logo */}
      <SidebarHeader className="h-16 border-b border-sidebar-border justify-center">
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
        {navigation.map((section) => (
          <Collapsible
            key={section.label}
            open={openSection === section.label}
            onOpenChange={(open) =>
              setOpenSection(open ? section.label : null)
            }
            className="group/collapsible"
          >
            <SidebarGroup>
              <AnimatedSectionHeader section={section} />
              <CollapsibleContent>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {section.items.map((item) => {
                      const isItemActive = pathname === item.href || pathname.startsWith(item.href + "/");
                      return (
                        <AnimatedNavItem
                          key={item.href}
                          item={item}
                          isActive={isItemActive}
                        />
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>
        ))}
      </SidebarContent>

      {/* Footer */}
      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <AnimatedFooterItem
            href="/help"
            icon={AnimatedHelpCircle}
            label="Help"
            isActive={pathname.startsWith("/help")}
          />
          <AnimatedFooterItem
            href="/settings"
            icon={AnimatedSettings}
            label="Settings"
            isActive={pathname.startsWith("/settings")}
          />
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
