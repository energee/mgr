import type { Metadata } from "next";

/** Page metadata for the pos route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Purchase Orders" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
