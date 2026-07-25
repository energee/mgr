import type { Metadata } from "next";

/** Page metadata for the finished-goods route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Finished Goods" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
