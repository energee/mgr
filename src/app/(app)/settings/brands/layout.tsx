/**
 * Brands Layout
 *
 * Provides page metadata so browser tabs display "Brands | MGR".
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Brands",
};

export default function BrandsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
