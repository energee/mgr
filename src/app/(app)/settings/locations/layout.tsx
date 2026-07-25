import type { Metadata } from "next";

/** Page metadata for the locations route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Locations" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
