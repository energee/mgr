/**
 * Inventory Items Layout
 *
 * Provides page metadata so browser tabs display "Inventory Items | MGR".
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Inventory Items",
};

export default function InventoryItemsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
