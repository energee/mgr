import type { Metadata } from "next";

/** Page metadata for the allocations route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Allocations" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
