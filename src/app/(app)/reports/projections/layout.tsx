import type { Metadata } from "next";

/** Page metadata for the projections route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Ingredient Projections" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
