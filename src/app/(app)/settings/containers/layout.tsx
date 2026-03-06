/**
 * Containers Layout
 *
 * Provides page metadata so browser tabs display "Containers | MGR".
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Containers",
};

export default function ContainersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
