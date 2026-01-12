import { redirect } from "next/navigation";

/**
 * Root Page Redirect
 *
 * Redirects to the main production dashboard.
 */
export default function RootPage() {
  redirect("/dashboard");
}
