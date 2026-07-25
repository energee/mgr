import type { Metadata } from "next";

/** Page metadata for the pricing route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Pricing" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
