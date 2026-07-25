import type { Metadata } from "next";

/** Page metadata for the notifications route; the layout itself is a pass-through. */
export const metadata: Metadata = { title: "Notifications" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
