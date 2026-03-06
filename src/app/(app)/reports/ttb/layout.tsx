/**
 * TTB Report Layout
 *
 * Provides page metadata so browser tabs display "TTB Report | MGR".
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TTB Report",
};

export default function TtbReportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
