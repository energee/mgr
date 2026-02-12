import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal/portal-shell";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/portal/login");
  }

  // Find linked customer
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  let { data: customer } = await db
    .from("customers")
    .select("id, name, email")
    .eq("user_id", user.id)
    .single();

  // Auto-link by email on first login
  if (!customer && user.email) {
    const adminDb = await createAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adminAny = adminDb as any;
    const { data: matched } = await adminAny
      .from("customers")
      .select("id, name, email")
      .eq("email", user.email)
      .is("user_id", null)
      .single();

    if (matched) {
      await adminAny
        .from("customers")
        .update({ user_id: user.id })
        .eq("id", matched.id);
      customer = matched;
    }
  }

  if (!customer) {
    return <PortalShell customer={null}>{children}</PortalShell>;
  }

  // Get brewery branding
  const { data: settings } = await db
    .from("system_settings")
    .select("key, value")
    .in("key", ["brewery_name", "brewery_logo_svg"]);

  const settingsMap: Record<string, unknown> = {};
  for (const row of settings || []) {
    settingsMap[row.key as string] = row.value;
  }

  return (
    <PortalShell
      customer={{ id: customer.id, name: customer.name }}
      breweryName={(settingsMap.brewery_name as string) || null}
      breweryLogo={(settingsMap.brewery_logo_svg as string) || null}
    >
      {children}
    </PortalShell>
  );
}
