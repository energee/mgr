import type { Metadata } from "next";

/** Page metadata for the water-profiles route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Water Profiles" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
