/**
 * Sales Dashboard Layout
 *
 * Provides page metadata so browser tabs display "Sales Dashboard | MGR".
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sales Dashboard",
};

export default function SalesDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
