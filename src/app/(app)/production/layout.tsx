/**
 * Production Layout
 *
 * Provides page metadata for the production domain so browser tabs
 * display "Production | MGR" instead of the generic app title.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Production",
};

export default function ProductionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
