import type {
  DataRow,
  DatasetSummary,
  Issue,
  Suggestion,
} from "@/lib/contracts";

/**
 * Drives the chunked pipeline from the browser. Each call returns quickly and
 * reports progress, so a large file shows a real progress bar instead of a
 * single request that would blow past the platform's timeout.
 */

export type PipelineStage = "parsing" | "profiling" | "enriching" | "ready";

export type PipelineProgress = {
  stage: PipelineStage;
  progress: number;
  detail?: string;
};

export type DatasetPayload = {
  summary: DatasetSummary;
  rows: DataRow[];
  issues: Issue[];
  suggestions: Suggestion[];
  ruleShare: number;
};

async function postJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, { method: "POST" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(body.error ?? `${url} failed (${response.status})`));
  }
  return body;
}

export async function fetchDataset(id: string): Promise<DatasetPayload> {
  const response = await fetch(`/api/datasets/${id}`);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(String(body.error ?? "Could not load the dataset"));
  }
  return response.json();
}

/** Guards against a bug in the loop turning into an unbounded request storm. */
const MAX_ITERATIONS = 200;

export async function runPipeline(
  id: string,
  status: DatasetSummary["status"],
  onProgress: (progress: PipelineProgress) => void,
): Promise<void> {
  if (status === "uploaded") {
    onProgress({ stage: "parsing", progress: 0, detail: "Reading the file" });
    const parsed = await postJson(`/api/datasets/${id}/parse`);
    const rowCount = Number(parsed.rowCount ?? 0);
    onProgress({
      stage: "parsing",
      progress: 1,
      detail: parsed.truncated
        ? `Capped at ${rowCount.toLocaleString()} of ${Number(parsed.totalSeen).toLocaleString()} rows`
        : `${rowCount.toLocaleString()} rows`,
    });
  }

  if (status === "uploaded" || status === "profiling") {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const result = await postJson(`/api/datasets/${id}/profile`);
      onProgress({
        stage: "profiling",
        progress: Number(result.progress ?? 0),
        detail: `${Number(result.processed ?? 0).toLocaleString()} of ${Number(result.total ?? 0).toLocaleString()} rows profiled`,
      });
      if (result.done) break;
    }
  }

  if (status !== "ready") {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const result = await postJson(`/api/datasets/${id}/enrich`);
      onProgress({
        stage: "enriching",
        progress: Number(result.progress ?? 1),
        detail:
          Number(result.remaining ?? 0) > 0
            ? `${result.remaining} ambiguous issues left for ${result.provider ?? "the model"}`
            : "Enrichment complete",
      });
      if (result.done) break;
    }
  }

  onProgress({ stage: "ready", progress: 1 });
}
