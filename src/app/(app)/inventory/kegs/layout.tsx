import type { Metadata } from "next";

/** Page metadata for the kegs route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Kegs" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
