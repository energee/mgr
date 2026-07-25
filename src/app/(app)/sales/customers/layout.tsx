import type { Metadata } from "next";

/** Page metadata for the customers route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Customers" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
