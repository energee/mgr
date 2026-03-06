/**
 * Demand Planning Layout
 *
 * Provides page metadata so browser tabs display "Demand Planning | MGR".
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Demand Planning",
};

export default function DemandPlanningLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
