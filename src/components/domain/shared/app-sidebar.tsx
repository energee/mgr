"use client";

/**
 * App Sidebar
 *
 * Main navigation sidebar for the application.
 * Uses shadcn Sidebar components for mobile responsiveness.
 * Animated icons on hover. Sections (Production, Inventory, Purchasing,
 * Sales) render always-open — no collapse/expand state — per the
 * 2026-07-12 mobile-UX nav simplification.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useContext, useRef } from "react";
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
  AnimatedSettings,
  AnimatedHelpCircle,
} from "@/components/icons/animated";
import type { AnimatedIconHandle } from "@/components/icons/animated";
// Navigation structure is shared with the cmd+K command palette and the
// mobile bottom tab bar — a NavEntry[] union of direct links and sections.
import { navigation, isNavSection } from "@/components/domain/shared/nav-items";
import type { AnimatedIcon } from "@/components/domain/shared/nav-items";

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

export function AppSidebar() {
  const pathname = usePathname();
  const { can } = usePermissions();
  const { openHelp } = useContext(KeyboardShortcutsContext);
  const keyboardIconRef = useRef<AnimatedIconHandle>(null);

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
        {navigation.map((entry) =>
          isNavSection(entry) ? (
            <SidebarGroup key={entry.label}>
              <SidebarGroupLabel className="flex items-center gap-2">
                <entry.icon className="h-4 w-4" />
                {entry.label}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {entry.items.map((item) => (
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
            </SidebarGroup>
          ) : (
            <SidebarGroup key={entry.href}>
              <SidebarMenu>
                <AnimatedNavLink
                  href={entry.href}
                  icon={entry.icon}
                  label={entry.label}
                  isActive={pathname === entry.href || pathname.startsWith(entry.href + "/")}
                />
              </SidebarMenu>
            </SidebarGroup>
          )
        )}
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
