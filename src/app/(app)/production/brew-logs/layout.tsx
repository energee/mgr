import type { Metadata } from "next";

/** Page metadata for the brew-logs route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Brew Logs" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
