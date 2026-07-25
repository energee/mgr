import type { Metadata } from "next";

/** Page metadata for the production route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Production" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
