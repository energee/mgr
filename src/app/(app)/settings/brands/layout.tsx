import type { Metadata } from "next";

/** Page metadata for the brands route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Brands" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
