/**
 * Update Password Layout
 *
 * Mirrors the auth split-screen layout but does NOT redirect logged-in users —
 * recovery flow lands here with a fresh session and needs to stay on the page.
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AuthShell } from "@/components/auth/auth-shell";

export const metadata: Metadata = {
  title: "Set a new password",
};

type UpdatePasswordLayoutProps = {
  children: ReactNode;
};

export default function UpdatePasswordLayout({ children }: UpdatePasswordLayoutProps) {
  return <AuthShell>{children}</AuthShell>;
}
