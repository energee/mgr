/**
 * Purchasing Layout
 *
 * Provides page metadata for the purchasing domain so browser tabs
 * display "Purchasing | MGR" instead of the generic app title.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Purchasing",
};

export default function PurchasingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
