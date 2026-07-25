import type { Metadata } from "next";

/** Page metadata for the items route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Inventory Items" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
