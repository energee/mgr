/**
 * Production Summary Report Layout
 *
 * Provides page metadata so browser tabs display
 * "Production Summary | MGR" instead of the generic app title.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Production Summary",
};

export default function ProductionSummaryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
