/**
 * Settings Layout (server component)
 *
 * Exports page metadata for browser tab titles and delegates UI rendering
 * to the SettingsNav client component for interactive sidebar navigation.
 */

import type { Metadata } from "next";
import { SettingsNav } from "./settings-nav";

export const metadata: Metadata = {
  title: "Settings",
};

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SettingsNav>{children}</SettingsNav>;
}
