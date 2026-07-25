import type { Metadata } from "next";

/** Page metadata for the integrations route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Integrations" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
