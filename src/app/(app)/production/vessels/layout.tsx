/**
 * Vessels Layout
 *
 * Provides page metadata so browser tabs display "Vessels | MGR".
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Vessels",
};

export default function VesselsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
