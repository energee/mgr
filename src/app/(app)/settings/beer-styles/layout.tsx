/**
 * Beer Styles Layout
 *
 * Provides page metadata so browser tabs display "Beer Styles | MGR".
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Beer Styles",
};

export default function BeerStylesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
