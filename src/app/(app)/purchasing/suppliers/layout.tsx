/**
 * Suppliers Layout
 *
 * Provides page metadata so browser tabs display "Suppliers | MGR".
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Suppliers",
};

export default function SuppliersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
