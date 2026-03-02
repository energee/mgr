/**
 * Inventory Valuation Report Layout
 *
 * Provides page metadata so browser tabs display
 * "Inventory Valuation | Reports | MGR".
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Inventory Valuation",
};

export default function InventoryValuationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
