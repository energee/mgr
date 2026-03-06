/**
 * Yeasts Layout
 *
 * Provides page metadata so browser tabs display "Yeasts | MGR".
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Yeasts",
};

export default function YeastsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
