import type { Metadata } from "next";

/** Page metadata for the batches route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Batches" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
