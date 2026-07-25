import type { Metadata } from "next";

/** Page metadata for the containers route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Containers" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
