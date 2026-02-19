import Link from "next/link";

/** 404 page for the app layout (shown when notFound() is called). */
export default function NotFound() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4">
      <h1 className="text-4xl font-bold">404</h1>
      <p className="text-muted-foreground">Page not found.</p>
      <Link
        href="/"
        className="text-sm underline underline-offset-4 hover:text-foreground"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
