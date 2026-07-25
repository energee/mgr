import type { Metadata } from "next";

/** Page metadata for the transfers route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Transfers" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
