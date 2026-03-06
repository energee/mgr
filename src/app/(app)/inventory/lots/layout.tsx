/**
 * Inventory Lots Layout
 *
 * Provides page metadata so browser tabs display "Inventory Lots | MGR".
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Inventory Lots",
};

export default function InventoryLotsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
