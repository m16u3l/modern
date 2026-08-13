import Link from "next/link";
import { Bot, Ruler } from "lucide-react";
import { UploadPanel } from "@/components/upload-panel";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-8 px-4 py-10 sm:gap-10 sm:px-6 sm:py-14">
      <div className="flex flex-col gap-4">
        <h1 className="text-3xl font-semibold text-balance">
          Clean up a messy CSV without trusting a model blindly
        </h1>
        <p className="text-muted-foreground text-base text-pretty">
          A deterministic rules engine catches everything it can on its own; only
          the genuinely ambiguous cases reach an LLM. You review every proposed
          fix, grouped by pattern rather than one row at a time, and export a
          clean file plus a full audit log.
        </p>
      </div>

      <UploadPanel />

      <dl className="grid gap-4 sm:grid-cols-2">
        <Feature
          icon={<Ruler className="size-4" aria-hidden />}
          title="Rules first"
          body="Duplicates, formats, disguised nulls and outliers are resolved by pure functions — cheap, deterministic and testable."
        />
        <Feature
          icon={<Bot className="size-4" aria-hidden />}
          title="LLM only for the rest"
          body="Near-duplicates and suspicious values go to the model with column context, never the whole dataset."
        />
      </dl>

      <p className="text-muted-foreground text-sm">
        Want to see the review experience without uploading anything?{" "}
        <Link
          href="/review"
          className="text-foreground font-medium underline decoration-border underline-offset-4 transition-colors hover:decoration-current"
        >
          Open the workspace on fixture data
        </Link>
        .
      </p>
    </main>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="bg-card flex flex-col gap-2 rounded-xl border p-5">
      <dt className="flex items-center gap-2.5 font-medium">
        <span
          className="bg-muted text-muted-foreground flex size-8 items-center justify-center rounded-lg"
          aria-hidden
        >
          {icon}
        </span>
        {title}
      </dt>
      <dd className="text-muted-foreground text-sm text-pretty">{body}</dd>
    </div>
  );
}
