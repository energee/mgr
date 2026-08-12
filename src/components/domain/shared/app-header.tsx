"use client";

/**
 * App Header
 *
 * Top header bar with brewery name and user menu. No mobile nav trigger
 * here — on phones (<md) the bottom MobileTabBar's "More" button opens the
 * sidebar's mobile sheet instead (2026-07-12 mobile-UX spec).
 */

import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { useTheme } from "next-themes";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { NotificationBell } from "@/components/domain/shared/notification-bell";
import { ChatToggle } from "@/components/domain/shared/chat-toggle";
import { SafeSvg } from "@/components/ui/safe-svg";
import { Sun, Moon, User as UserIcon, Settings, LogOut } from "lucide-react";

type AppHeaderProps = {
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

  return (
    <header className="h-12 border-b flex items-center justify-between px-4">
      {/* Left side: brewery logo + name */}
      <div className="flex items-center gap-2">
        {breweryLogoSvg && (
          <SafeSvg
            svg={breweryLogoSvg}
            className="h-8 w-8"
            ariaLabel={breweryName || "Brewery logo"}
          />
        )}
        <span className="text-sm font-medium">{breweryName}</span>
      </div>

      {/* Right side actions */}
      <div className="flex items-center gap-2">
        {/* Theme toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label="Toggle theme"
        >
          <Sun className="h-5 w-5 rotate-0 scale-100 transition-transform dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-transform dark:rotate-0 dark:scale-100" />
        </Button>

        {/* Notifications */}
        <NotificationBell />

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2">
              <UserIcon className="h-4 w-4" />
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
            <DropdownMenuItem onClick={() => router.push("/settings")}>
              <Settings className="h-4 w-4 mr-2" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut}>
              <LogOut className="h-4 w-4 mr-2" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Claude AI assistant */}
        <ChatToggle />
      </div>
    </header>
  );
}
