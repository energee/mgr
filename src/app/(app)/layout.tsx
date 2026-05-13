/**
 * App Layout
 *
 * Main authenticated layout with sidebar navigation.
 * All protected routes render within this layout.
 */

import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import type { UserRole } from "@/lib/permissions";
import { AppSidebar } from "@/components/domain/app-sidebar";
import { AppHeader } from "@/components/domain/app-header";
import { AppProviders } from "@/components/domain/app-providers";
import { ChatLayout } from "@/components/domain/chat-layout";
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
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("roles")
    .eq("id", user.id)
    .single();

  // Cast needed: generated types don't include the `roles` column yet
  const roles = ((profile as Record<string, unknown> | null)?.roles ?? ["viewer"]) as UserRole[];

  if (roles.length === 1 && roles[0] === "customer") {
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
