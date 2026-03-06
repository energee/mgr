/**
 * Batches Layout
 *
 * Provides page metadata so browser tabs display "Batches | MGR".
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Batches",
};

export default function BatchesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
