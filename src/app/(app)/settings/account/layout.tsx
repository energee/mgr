import type { Metadata } from "next";

/** Page metadata for the account route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Account" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
