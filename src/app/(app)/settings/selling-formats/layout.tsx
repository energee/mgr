import type { Metadata } from "next";

/** Page metadata for the selling-formats route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Selling Formats" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
