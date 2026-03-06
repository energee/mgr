/**
 * Account Settings Layout
 *
 * Provides page metadata so browser tabs display "Account | MGR".
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Account",
};

export default function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
