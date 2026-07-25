import type { Metadata } from "next";

/** Page metadata for the packaging route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Packaging" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
