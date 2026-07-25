import type { Metadata } from "next";

/** Page metadata for the recipes route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Recipes" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
