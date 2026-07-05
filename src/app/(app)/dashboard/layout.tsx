/**
 * Dashboard Layout
 *
 * Provides page metadata for the dashboard so browser tabs
 * display "Dashboard | MGR" instead of the generic app title.
 */

import type { Metadata } from "next";
// Imported here (not in BatchActivityHeatmap) so tooltip styles ship with the
// route CSS instead of the lazy heatmap chunk, avoiding a FOUC (audit F-142).
import "react-activity-calendar/tooltips.css";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
