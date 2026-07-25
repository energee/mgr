import type { Metadata } from "next";

/** Page metadata for the vessels route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Vessels" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
