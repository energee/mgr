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
  AnimatedSettings,
  AnimatedHelpCircle,
  AnimatedChevronDown,
} from "@/components/icons/animated";
import type { AnimatedIconHandle } from "@/components/icons/animated";
// Navigation structure is shared with the cmd+K command palette.
import { navigation } from "@/components/domain/shared/nav-items";
import type { AnimatedIcon, NavSection } from "@/components/domain/shared/nav-items";

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
