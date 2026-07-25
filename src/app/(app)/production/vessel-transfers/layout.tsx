import type { Metadata } from "next";

/** Page metadata for the vessel-transfers route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Vessel Transfers" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
