import type { Metadata } from "next";

/** Page metadata for the yeasts route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Yeasts" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
