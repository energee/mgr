import type { Metadata } from "next";

/** Page metadata for the purchasing route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Purchasing" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
