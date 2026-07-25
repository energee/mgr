import type { Metadata } from "next";

/** Page metadata for the beer-styles route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Beer Styles" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
