/**
 * Deliveries Layout
 *
 * Provides page metadata so browser tabs display "Deliveries | MGR".
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Deliveries",
};

export default function DeliveriesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
