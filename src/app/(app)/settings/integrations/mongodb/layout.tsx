import type { Metadata } from "next";

/** Page metadata for the mongodb route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "MongoDB Sync" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
