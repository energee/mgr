import { notFound } from "next/navigation";

/** Brew logs are created via "Start Brew Day" on a batch — no standalone creation. */
export default function BrewLogNewPage() {
  notFound();
}
