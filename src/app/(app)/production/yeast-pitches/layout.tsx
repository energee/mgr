import type { Metadata } from "next";

/** Page metadata for the yeast-pitches route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Yeast Pitches" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
