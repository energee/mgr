/**
 * Pricing Layout
 *
 * Provides page metadata so browser tabs display "Pricing | MGR".
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing",
};

export default function PricingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
