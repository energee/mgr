/**
 * Packaging Layout
 *
 * Provides page metadata so browser tabs display "Packaging | MGR".
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Packaging",
};

export default function PackagingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
