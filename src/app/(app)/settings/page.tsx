/**
 * Settings Page
 *
 * Redirects to the first settings section.
 * Navigation is handled by the settings layout sidebar.
 */

import { redirect } from "next/navigation";

export default function SettingsPage() {
  redirect("/settings/system");
}
