/**
 * Inventory Dashboard Layout
 *
 * Provides page metadata so browser tabs display "Inventory Dashboard | MGR".
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Inventory Dashboard",
};

export default function InventoryDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
