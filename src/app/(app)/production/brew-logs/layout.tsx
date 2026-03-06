/**
 * Brew Logs Layout
 *
 * Provides page metadata so browser tabs display "Brew Logs | MGR".
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Brew Logs",
};

export default function BrewLogsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
