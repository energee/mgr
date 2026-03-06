/**
 * Finished Goods Layout
 *
 * Provides page metadata so browser tabs display "Finished Goods | MGR".
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Finished Goods",
};

export default function FinishedGoodsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
