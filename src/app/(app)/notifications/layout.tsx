/**
 * Notifications Layout
 *
 * Provides page metadata for the notifications section so browser tabs
 * display "Notifications | MGR" instead of the generic app title.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Notifications",
};

export default function NotificationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
