/**
 * Customers Layout
 *
 * Provides page metadata so browser tabs display "Customers | MGR".
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Customers",
};

export default function CustomersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
