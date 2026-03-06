/**
 * Locations Layout
 *
 * Provides page metadata so browser tabs display "Locations | MGR".
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Locations",
};

export default function LocationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
