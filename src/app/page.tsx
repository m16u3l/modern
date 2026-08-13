import Link from "next/link";
import { Bot, Ruler } from "lucide-react";
import { UploadPanel } from "@/components/upload-panel";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-8 p-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">
          AI Data Cleanup Assistant
        </h1>
        <p className="text-muted-foreground mt-2">
          Upload a messy CSV. A deterministic rules engine catches everything it
          can on its own; only the genuinely ambiguous cases reach an LLM. You
          review every proposed fix, in patterns rather than one row at a time,
          and export a clean file plus a full audit log.
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

      <p className="text-muted-foreground text-xs">
        Want to see the review experience without uploading anything?{" "}
        <Link href="/review" className="underline underline-offset-2">
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
    <div className="rounded-lg border p-4">
      <dt className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
      </dt>
      <dd className="text-muted-foreground mt-1 text-sm">{body}</dd>
    </div>
  );
}
