/**
 * Users Layout
 *
 * Provides page metadata so browser tabs display "Users | MGR".
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Users",
};

export default function UsersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
