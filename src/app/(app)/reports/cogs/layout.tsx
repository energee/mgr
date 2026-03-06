/**
 * Cost of Goods Sold Report Layout
 *
 * Provides page metadata for the COGS report.
 * Browser tab displays "Cost of Goods Sold | MGR".
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cost of Goods Sold",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
