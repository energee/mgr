/**
 * Dashboard Layout
 *
 * Provides page metadata for the dashboard so browser tabs
 * display "Dashboard | MGR" instead of the generic app title.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
