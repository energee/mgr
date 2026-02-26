/**
 * Sales Layout
 *
 * Provides page metadata for the sales domain so browser tabs
 * display "Sales | MGR" instead of the generic app title.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sales",
};

export default function SalesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
