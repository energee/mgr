/**
 * System Settings Layout
 *
 * Provides page metadata so browser tabs display "System Settings | MGR".
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "System Settings",
};

export default function SystemSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
