/**
 * Dashboard Layout
 *
 * Provides page metadata for the dashboard so browser tabs
 * display "Dashboard | MGR" instead of the generic app title.
 *
 * The react-activity-calendar tooltip stylesheet is imported here so it ships
 * with the route's CSS bundle regardless of how BatchActivityHeatmap loads.
 * Importing it inside the heatmap component defers the stylesheet to the
 * component's own chunk and causes tooltip FOUC on first render.
 */

import type { Metadata } from "next";
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
