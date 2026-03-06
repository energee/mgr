/**
 * Kegs Layout
 *
 * Provides page metadata so browser tabs display "Kegs | MGR".
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Kegs",
};

export default function KegsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
