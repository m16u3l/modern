import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { DatasetView } from "./dataset-view";

export default async function DatasetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
      {/* "Home" used to live here; it is in the site header now, so this row is
          only for the link that is specific to this dataset. */}
      <p className="mb-4 flex justify-end">
        <Link
          href={`/datasets/${id}/trace`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded-md text-sm transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          What the pipeline did
          <ArrowUpRight className="size-4" aria-hidden />
        </Link>
      </p>
      <DatasetView datasetId={id} />
    </main>
  );
}
