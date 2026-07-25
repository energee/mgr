import type { Metadata } from "next";

/** Page metadata for the help route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Help" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
