import type { Metadata } from "next";

/** Page metadata for the demand route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Demand Planning" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
