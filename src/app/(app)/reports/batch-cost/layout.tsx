/**
 * Batch Cost Analysis Layout
 *
 * Provides page metadata for the batch cost analysis report.
 * Browser tab displays "Batch Cost Analysis | MGR".
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Batch Cost Analysis",
};

export default function BatchCostLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
