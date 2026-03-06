/**
 * Sales Channels Layout
 *
 * Provides page metadata so browser tabs display "Sales Channels | MGR".
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sales Channels",
};

export default function SalesChannelsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
