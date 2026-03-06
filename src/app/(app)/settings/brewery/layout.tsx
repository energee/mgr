/**
 * Brewery Settings Layout
 *
 * Provides page metadata so browser tabs display "Brewery | MGR".
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Brewery",
};

export default function BreweryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
