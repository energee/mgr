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
import { useRef } from "react";
import { MGRIcon } from "@/components/icons/mgr-logo";
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

  return (
    <Sidebar>
      {/* Logo */}
      <SidebarHeader className="border-b border-sidebar-border">
        <Link href="/" className="flex items-center gap-2 px-2 py-1">
          <MGRIcon size={20} className="shrink-0" />
          <span className="text-lg font-semibold tracking-tight leading-none">MGR</span>
        </Link>
      </SidebarHeader>

      {/* Navigation */}
      <SidebarContent>
        {navigation.map((section) => {
          const isActive = section.items.some((item) => pathname.startsWith(item.href));

          return (
            <Collapsible
              key={section.label}
              defaultOpen={isActive}
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
          );
        })}
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
