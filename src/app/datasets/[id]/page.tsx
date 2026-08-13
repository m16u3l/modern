import Link from "next/link";
import { DatasetView } from "./dataset-view";

export default async function DatasetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 p-6">
      <p className="text-muted-foreground mb-4 text-xs">
        <Link href="/" className="underline underline-offset-2">
          Home
        </Link>
      </p>
      <DatasetView datasetId={id} />
    </main>
  );
}
