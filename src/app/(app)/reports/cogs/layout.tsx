import type { Metadata } from "next";

/** Page metadata for the cogs route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Cost of Goods Sold" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
