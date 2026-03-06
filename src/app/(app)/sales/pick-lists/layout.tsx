/**
 * Pick Lists Layout
 *
 * Provides page metadata so browser tabs display "Pick Lists | MGR".
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pick Lists",
};

export default function PickListsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
