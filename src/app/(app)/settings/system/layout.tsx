import type { Metadata } from "next";

/** Page metadata for the system route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "System Settings" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
