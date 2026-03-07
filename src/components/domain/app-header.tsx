"use client";

/**
 * App Header
 *
 * Top header bar with brewery name and user menu.
 */

import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { useTheme } from "next-themes";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AnimatedUser, AnimatedSettings, AnimatedLogOut } from "@/components/icons/animated";
import type { AnimatedIconHandle } from "@/components/icons/animated";
import { useRef } from "react";
import { toast } from "sonner";
import { NotificationBell } from "@/components/domain/notification-bell";
import DOMPurify from "isomorphic-dompurify";
import { Sun, Moon } from "lucide-react";

interface AppHeaderProps {
  user: User;
  breweryName: string;
  breweryLogoSvg?: string | null;
}

export function AppHeader({ user, breweryName, breweryLogoSvg }: AppHeaderProps) {
  const router = useRouter();
  const supabase = createClient();
  const { theme, setTheme } = useTheme();

  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error("Failed to sign out");
      return;
    }
    router.push("/login");
    router.refresh();
  };

  const userIconRef = useRef<AnimatedIconHandle>(null);
  const settingsIconRef = useRef<AnimatedIconHandle>(null);
  const logoutIconRef = useRef<AnimatedIconHandle>(null);

  return (
    <header className="h-12 border-b flex items-center justify-between px-4">
      {/* Left side: menu trigger + brewery logo + name */}
      <div className="flex items-center gap-2">
        <SidebarTrigger className="md:hidden" />
        {breweryLogoSvg && (
          <span
            className="h-8 w-8 inline-flex items-center justify-center text-foreground [&_svg]:h-full [&_svg]:w-full [&_*]:fill-current"
            role="img"
            aria-label={breweryName || "Brewery logo"}
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(breweryLogoSvg) }}
          />
        )}
        <span className="text-sm font-medium">{breweryName}</span>
      </div>

      {/* Right side actions */}
      <div className="flex items-center gap-2">
        {/* Theme toggle */}
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label="Toggle theme"
        >
          <Sun className="h-3.5 w-3.5 rotate-0 scale-100 transition-transform dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-3.5 w-3.5 rotate-90 scale-0 transition-transform dark:rotate-0 dark:scale-100" />
        </Button>

        {/* Notifications */}
        <NotificationBell />

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="gap-2"
              onMouseEnter={() => userIconRef.current?.startAnimation()}
              onMouseLeave={() => userIconRef.current?.stopAnimation()}
            >
              <AnimatedUser ref={userIconRef} className="h-4 w-4" />
              <span className="hidden sm:inline">{user.email}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span>{user.email}</span>
                <span className="text-xs text-muted-foreground font-normal">
                  {breweryName}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => router.push("/settings")}
              onMouseEnter={() => settingsIconRef.current?.startAnimation()}
              onMouseLeave={() => settingsIconRef.current?.stopAnimation()}
            >
              <AnimatedSettings ref={settingsIconRef} className="h-4 w-4 mr-2" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleSignOut}
              onMouseEnter={() => logoutIconRef.current?.startAnimation()}
              onMouseLeave={() => logoutIconRef.current?.stopAnimation()}
            >
              <AnimatedLogOut ref={logoutIconRef} className="h-4 w-4 mr-2" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
