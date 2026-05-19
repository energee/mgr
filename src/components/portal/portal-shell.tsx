"use client";

import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { PortalProvider } from "@/contexts/portal";
import { Button } from "@/components/ui/button";
import { SafeSvg } from "@/components/ui/safe-svg";
import { LogOut } from "lucide-react";

type PortalShellProps = {
  children: React.ReactNode;
  customers: { id: string; name: string }[];
  breweryName?: string | null;
  breweryLogo?: string | null;
  breweryEmail?: string | null;
}

export function PortalShell({
  children,
  customers,
  breweryName,
  breweryLogo,
  breweryEmail,
}: PortalShellProps) {
  const router = useRouter();
  const supabase = createClient();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/portal/login");
    router.refresh();
  }

  if (customers.length === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
        <div className="max-w-md space-y-4 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            No Account Linked
          </h1>
          <p className="text-muted-foreground">
            Your email isn&apos;t linked to a customer account.
            {breweryEmail ? (
              <> Contact us at{" "}
                <a href={`mailto:${breweryEmail}`} className="font-medium text-foreground underline underline-offset-4">
                  {breweryEmail}
                </a>{" "}
                for access.
              </>
            ) : (
              <> Please contact the brewery for access.</>
            )}
          </p>
          <Button variant="outline" onClick={handleLogout}>
            <LogOut className="mr-2 h-4 w-4" />
            Log Out
          </Button>
        </div>
      </div>
    );
  }

  const displayName =
    customers.length === 1
      ? customers[0].name
      : `${customers[0].name} +${customers.length - 1}`;

  return (
    <PortalProvider
      value={{
        customers,
        customerIds: customers.map((c) => c.id),
      }}
    >
      <div className="flex min-h-screen flex-col bg-background">
        <header className="sticky top-0 z-50 border-b bg-background">
          <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
            <div className="flex items-center gap-6">
              <Link href="/portal/orders" className="flex items-center gap-2">
                {breweryLogo ? (
                  <SafeSvg svg={breweryLogo} className="h-8 w-8" />
                ) : (
                  <span className="text-lg font-semibold tracking-tight">
                    {breweryName || "Brewery"}
                  </span>
                )}
              </Link>
              <nav className="flex items-center gap-4">
                <Link
                  href="/portal/orders"
                  className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  Orders
                </Link>
              </nav>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-muted-foreground">
                {displayName}
              </span>
              <Button variant="ghost" size="sm" onClick={handleLogout}>
                <LogOut className="mr-2 h-4 w-4" />
                Log Out
              </Button>
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
          {children}
        </main>
      </div>
    </PortalProvider>
  );
}
