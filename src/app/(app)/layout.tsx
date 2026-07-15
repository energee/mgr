/**
 * App Layout
 *
 * Main authenticated layout with sidebar navigation.
 * All protected routes render within this layout.
 */

import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { isPortalUser, type UserRole } from "@/lib/permissions";
import { AppSidebar } from "@/components/domain/shared/app-sidebar";
import { AppHeader } from "@/components/domain/shared/app-header";
import { AppProviders } from "@/components/domain/shared/app-providers";
import { ChatLayout } from "@/components/domain/shared/chat-layout";
import { CommandPalette } from "@/components/domain/shared/command-palette";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { dynamicFrom } from "@/services/types";

type AppLayoutProps = {
  children: ReactNode;
}

export default async function AppLayout({ children }: AppLayoutProps) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Redirect customer-role users to the customer portal
  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("roles, status")
    .eq("id", user.id)
    .single();

  // A valid old JWT can outlive deactivation. Fail closed on inactive,
  // pending, missing, or unreadable profiles before any protected data read.
  if (profileError || !profile || profile.status !== "active") {
    redirect("/login?error=account_disabled");
  }

  // Cast needed: generated types don't include the `roles` column yet
  const roles = ((profile as Record<string, unknown>).roles ?? []) as UserRole[];

  // Any role set containing 'customer' belongs in the portal (audit C1:
  // requiring exactly ['customer'] let mixed role sets into the staff app).
  if (isPortalUser(roles)) {
    redirect("/portal/orders");
  }

  // Get brewery name and logo from system_settings
  const { data: settings } = await dynamicFrom(supabase, "system_settings")
    .select("key, value")
    .in("key", ["brewery_name", "brewery_logo_svg"]);

  const settingsMap: Record<string, unknown> = {};
  for (const row of settings || []) {
    settingsMap[row.key as string] = row.value;
  }
  const breweryName = (settingsMap.brewery_name as string) || "My Brewery";
  const breweryLogoSvg = (settingsMap.brewery_logo_svg as string) || null;

  return (
    <AppProviders roles={roles}>
      {/* Global cmd+K navigation palette — mounted once for all app routes */}
      <CommandPalette />
      <SidebarProvider>
        {/* Wrap in <aside> so screen-reader landmark navigation surfaces the
            sidebar alongside the existing <main> from SidebarInset (audit F-099). */}
        <aside aria-label="Primary navigation">
          <AppSidebar />
        </aside>
        <SidebarInset>
          <ChatLayout header={<AppHeader user={user} breweryName={breweryName} breweryLogoSvg={breweryLogoSvg} />}>
            {children}
          </ChatLayout>
        </SidebarInset>
      </SidebarProvider>
    </AppProviders>
  );
}
