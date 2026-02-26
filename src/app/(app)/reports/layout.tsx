/**
 * Reports Layout
 *
 * Provides page metadata for the reports section so browser tabs
 * display "Reports | MGR" instead of the generic app title.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Reports",
};

export default function ReportsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
