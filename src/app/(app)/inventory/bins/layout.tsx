import type { Metadata } from "next";

/** Page metadata for the bins route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Bins" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
