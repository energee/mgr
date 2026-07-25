import type { Metadata } from "next";

/** Page metadata for the inventory-valuation route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Inventory Valuation" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
