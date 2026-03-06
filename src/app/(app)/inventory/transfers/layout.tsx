/**
 * Transfers Layout
 *
 * Provides page metadata so browser tabs display "Transfers | MGR".
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Transfers",
};

export default function TransfersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
