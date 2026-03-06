/**
 * Water Profiles Layout
 *
 * Provides page metadata so browser tabs display "Water Profiles | MGR".
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Water Profiles",
};

export default function WaterProfilesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
