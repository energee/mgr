import type { Metadata } from "next";

/** Page metadata for the orders route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Orders" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
