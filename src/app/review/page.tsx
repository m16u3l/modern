import Link from "next/link";
import { ReviewWorkspace } from "@/components/workspace/review-workspace";
import {
  FIXTURE_ISSUES,
  FIXTURE_ROWS,
  FIXTURE_SUGGESTIONS,
  FIXTURE_SUMMARY,
} from "@/lib/fixtures";

/**
 * Fixture-backed workspace. It stays in the repo after the real pipeline lands:
 * it is how the review UX is developed and demoed without touching a database.
 */
export default function ReviewFixturesPage() {
  return (
    <main className="mx-auto w-full max-w-7xl flex-1 p-6">
      <p className="text-muted-foreground mb-4 text-xs">
        <Link href="/" className="underline underline-offset-2">
          Home
        </Link>{" "}
        · fixture data, no backend
      </p>
      <ReviewWorkspace
        summary={FIXTURE_SUMMARY}
        rows={FIXTURE_ROWS}
        issues={FIXTURE_ISSUES}
        suggestions={FIXTURE_SUGGESTIONS}
      />
    </main>
  );
}
