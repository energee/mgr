/**
 * App Layout
 *
 * Main authenticated layout with sidebar navigation.
 * All protected routes render within this layout.
 */

import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/domain/app-sidebar";
import { AppHeader } from "@/components/domain/app-header";
import { AppProviders } from "@/components/domain/app-providers";
import { ChatLayout } from "@/components/domain/chat-layout";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";

interface AppLayoutProps {
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
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role === "customer") {
    redirect("/portal/orders");
  }

  // Get brewery name and logo from system_settings
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: settings } = await db
    .from("system_settings")
    .select("key, value")
    .in("key", ["brewery_name", "brewery_logo_svg"]);

  const settingsMap: Record<string, unknown> = {};
  for (const row of settings || []) {
    settingsMap[row.key as string] = row.value;
  }
  const breweryName = (settingsMap.brewery_name as string) || "My Brewery";
  const breweryLogoSvg = (settingsMap.brewery_logo_svg as string) || null;

  return (
    <AppProviders>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <ChatLayout header={<AppHeader user={user} breweryName={breweryName} breweryLogoSvg={breweryLogoSvg} />}>
            {children}
          </ChatLayout>
        </SidebarInset>
      </SidebarProvider>
    </AppProviders>
  );
}
