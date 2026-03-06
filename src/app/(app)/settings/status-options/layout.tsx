/**
 * Status Options Layout
 *
 * Provides page metadata so browser tabs display "Status Options | MGR".
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Status Options",
};

export default function StatusOptionsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
