/**
 * Notification Settings Layout
 *
 * Provides page metadata so browser tabs display "Notification Settings | MGR".
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Notification Settings",
};

export default function NotificationSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
