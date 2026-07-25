import type { Metadata } from "next";

/** Page metadata for the sales-channels route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Sales Channels" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
