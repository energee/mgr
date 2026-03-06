/**
 * Vessel Transfers Layout
 *
 * Provides page metadata so browser tabs display "Vessel Transfers | MGR".
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Vessel Transfers",
};

export default function VesselTransfersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
