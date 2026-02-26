/**
 * Help Layout
 *
 * Provides page metadata for the help section so browser tabs
 * display "Help | MGR" instead of the generic app title.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Help",
};

export default function HelpLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
