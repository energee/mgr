import type { Metadata } from "next";

/** Page metadata for the users route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Users" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
