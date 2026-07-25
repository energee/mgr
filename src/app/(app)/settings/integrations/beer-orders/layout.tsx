import type { Metadata } from "next";

/** Page metadata for the beer-orders route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Beer Orders Spreadsheet" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
