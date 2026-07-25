import type { Metadata } from "next";

/** Page metadata for the sales route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Sales Dashboard" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
