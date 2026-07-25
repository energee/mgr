import type { Metadata } from "next";

/** Page metadata for the ttb route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "TTB Report" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
