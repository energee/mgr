/**
 * MongoDB Integration Layout
 *
 * Provides page metadata for the MongoDB sync settings page.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "MongoDB Sync",
};

export default function MongoDBLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
