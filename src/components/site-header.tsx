import Link from "next/link";
import { Sparkles } from "lucide-react";

/**
 * One bar on every page. Before this each route improvised its own "Home" link
 * in small grey text, which meant the way out of a dataset moved depending on
 * where you were standing.
 */
export function SiteHeader() {
  return (
    <header className="bg-background/85 sticky top-0 z-30 border-b backdrop-blur-sm">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-md font-medium tracking-tight focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <span
            className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-md"
            aria-hidden
          >
            <Sparkles className="size-4" />
          </span>
          AI Data Cleanup
        </Link>

        <Link
          href="/review"
          className="text-muted-foreground hover:text-foreground ml-auto rounded-md text-sm transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          Fixture workspace
        </Link>
      </div>
    </header>
  );
}
