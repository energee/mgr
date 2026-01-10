/**
 * Auth Layout
 *
 * Centered layout for login/signup pages.
 * No sidebar, simple centered card design.
 */

import type { ReactNode } from "react";

interface AuthLayoutProps {
  children: ReactNode;
}

export default function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
