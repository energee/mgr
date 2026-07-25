import type { Metadata } from "next";
// Imported here (not in BatchActivityHeatmap) so tooltip styles ship with the
// route CSS instead of the lazy heatmap chunk, avoiding a FOUC (audit F-142).
import "react-activity-calendar/tooltips.css";

/** Page metadata for the dashboard route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Dashboard" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
