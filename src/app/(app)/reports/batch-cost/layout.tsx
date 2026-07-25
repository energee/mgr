import type { Metadata } from "next";

/** Page metadata for the batch-cost route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Batch Cost Analysis" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
