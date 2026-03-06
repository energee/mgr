/**
 * Purchase Orders Layout
 *
 * Provides page metadata so browser tabs display "Purchase Orders | MGR".
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Purchase Orders",
};

export default function PurchaseOrdersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
