import type { Metadata } from "next";

/** Page metadata for the status-options route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Status Options" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
