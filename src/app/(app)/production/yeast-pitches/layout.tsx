/**
 * Yeast Pitches Layout
 *
 * Provides page metadata so browser tabs display "Yeast Pitches | MGR".
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Yeast Pitches",
};

export default function YeastPitchesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
