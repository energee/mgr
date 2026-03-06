/**
 * Selling Formats Layout
 *
 * Provides page metadata so browser tabs display "Selling Formats | MGR".
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Selling Formats",
};

export default function SellingFormatsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
