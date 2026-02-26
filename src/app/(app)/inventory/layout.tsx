/**
 * Inventory Layout
 *
 * Provides page metadata for the inventory domain so browser tabs
 * display "Inventory | MGR" instead of the generic app title.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Inventory",
};

export default function InventoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
