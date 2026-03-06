/**
 * Bins Layout
 *
 * Provides page metadata so browser tabs display "Bins | MGR".
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Bins",
};

export default function BinsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
