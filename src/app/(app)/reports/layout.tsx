import type { Metadata } from "next";

/** Page metadata for the reports route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Reports" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
