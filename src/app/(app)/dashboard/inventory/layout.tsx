import type { Metadata } from "next";

/** Page metadata for the inventory route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Inventory Dashboard" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
