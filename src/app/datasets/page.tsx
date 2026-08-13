import Link from "next/link";
import { ArrowUpRight, FileSpreadsheet } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { DatasetStatus } from "@/lib/contracts";
import { listDatasets, type DatasetListEntry } from "@/lib/persistence";

export const dynamic = "force-dynamic";

/**
 * The upload history. Until this existed the demo was a one-way trip: you
 * uploaded a file, and once you navigated away the only route back was the
 * dataset's UUID, which nothing ever showed you.
 */
export default async function DatasetsPage() {
  const datasets = await listDatasets();

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6">
      <h1 className="text-2xl font-semibold">Upload history</h1>
      <p className="text-muted-foreground mt-1.5 text-pretty">
        Every CSV analysed on this deployment, newest first. There are no
        accounts, so this is a shared list rather than yours alone.
      </p>

      {datasets.length === 0 ? (
        <div className="mt-8 flex flex-col items-center gap-3 rounded-xl border border-dashed p-8 text-center sm:p-12">
          <FileSpreadsheet className="text-muted-foreground size-9" aria-hidden />
          <h2 className="text-xl font-semibold">Nothing analysed yet</h2>
          <p className="text-muted-foreground max-w-sm text-pretty">
            Upload a CSV or load the demo dataset, and the run will show up here.
          </p>
          <Button asChild className="mt-1">
            <Link href="/">Start a run</Link>
          </Button>
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-3" role="list">
          {datasets.map((dataset) => (
            <DatasetRow key={dataset.id} dataset={dataset} />
          ))}
        </ul>
      )}
    </main>
  );
}

const STATUS_STYLES: Record<DatasetStatus, string> = {
  uploaded: "bg-muted text-muted-foreground",
  profiling: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  enriching: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  ready: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
};

function DatasetRow({ dataset }: { dataset: DatasetListEntry }) {
  const reviewed = dataset.suggestionCount - dataset.pendingCount;

  return (
    <li className="bg-card rounded-xl border p-4 transition-colors hover:bg-accent/25 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <Link
            href={`/datasets/${dataset.id}`}
            className="truncate rounded-md font-mono font-medium underline decoration-border underline-offset-4 transition-colors hover:decoration-current focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {dataset.filename}
          </Link>
          <p className="text-muted-foreground mt-1 text-sm">
            {dataset.rowCount.toLocaleString()} rows ·{" "}
            {dataset.createdAt.toISOString().replace("T", " ").slice(0, 16)} UTC
          </p>
        </div>

        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium",
            STATUS_STYLES[dataset.status],
          )}
        >
          {dataset.status}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3 text-sm">
        {dataset.suggestionCount === 0 ? (
          <span className="text-muted-foreground">
            {dataset.status === "ready"
              ? "Nothing to fix"
              : "No suggestions yet"}
          </span>
        ) : (
          <span className="text-muted-foreground tabular-nums">
            <span className="text-foreground font-medium">
              {reviewed}/{dataset.suggestionCount}
            </span>{" "}
            reviewed
            {dataset.pendingCount > 0 && ` · ${dataset.pendingCount} pending`}
          </span>
        )}

        <Link
          href={`/datasets/${dataset.id}/trace`}
          className="text-muted-foreground hover:text-foreground ml-auto inline-flex items-center gap-1 rounded-md transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          What the pipeline did
          <ArrowUpRight className="size-4" aria-hidden />
        </Link>
      </div>
    </li>
  );
}
