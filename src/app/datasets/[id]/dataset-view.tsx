"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Download, FileJson } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ReviewWorkspace } from "@/components/workspace/review-workspace";
import {
  WorkspaceEmpty,
  WorkspaceError,
  WorkspaceSkeleton,
} from "@/components/workspace/states";
import type { ApplySummary } from "@/lib/apply";
import {
  fetchDataset,
  runPipeline,
  type DatasetPayload,
  type PipelineProgress,
} from "@/lib/pipeline-client";

const STAGE_LABELS: Record<PipelineProgress["stage"], string> = {
  parsing: "Reading the file",
  profiling: "Profiling with the rules engine",
  enriching: "Escalating the ambiguous cases",
  ready: "Ready",
};

export function DatasetView({ datasetId }: { datasetId: string }) {
  const [payload, setPayload] = useState<DatasetPayload | null>(null);
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<ApplySummary | null>(null);

  const load = useCallback(async () => {
    try {
      // Nothing is set synchronously here on purpose: the first state update
      // happens after this await, so mounting never cascades a render.
      const initial = await fetchDataset(datasetId);

      if (initial.summary.status !== "ready") {
        await runPipeline(datasetId, initial.summary.status, setProgress);
        setPayload(await fetchDataset(datasetId));
      } else {
        setPayload(initial);
      }
      setProgress(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong");
      setProgress(null);
    }
  }, [datasetId]);

  useEffect(() => {
    // The pipeline is driven from the browser, so there is no framework loader
    // to hang this off. Fetch-on-mount is the correct shape here; the rule
    // cannot see that every state update happens after an await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, attempt]);

  if (error) {
    return (
      <WorkspaceError
        message={error}
        onRetry={() => {
          setError(null);
          setAttempt((n) => n + 1);
        }}
      />
    );
  }

  if (progress) {
    return (
      <div className="flex flex-col gap-4">
        <div className="bg-card rounded-xl border p-4 sm:p-5">
          <div className="flex items-baseline justify-between gap-4">
            <p className="font-medium">{STAGE_LABELS[progress.stage]}</p>
            <p className="text-muted-foreground text-sm tabular-nums">
              {Math.round(progress.progress * 100)}%
            </p>
          </div>
          <Progress value={progress.progress * 100} className="mt-3 h-2" />
          {progress.detail && (
            <p className="text-muted-foreground mt-2 text-sm">{progress.detail}</p>
          )}
        </div>
        <WorkspaceSkeleton />
      </div>
    );
  }

  if (!payload) return <WorkspaceSkeleton />;

  if (payload.suggestions.length === 0) {
    return (
      <WorkspaceEmpty
        title="No issues found"
        description={`${payload.summary.filename} came back clean — ${payload.summary.rowCount.toLocaleString()} rows with nothing worth flagging.`}
      />
    );
  }

  if (applied) {
    return (
      <ExportPanel
        datasetId={datasetId}
        summary={applied}
        filename={payload.summary.filename}
      />
    );
  }

  return (
    <ReviewWorkspace
      summary={payload.summary}
      rows={payload.rows}
      issues={payload.issues}
      suggestions={payload.suggestions}
      applying={applying}
      onApply={async (decisions) => {
        setApplying(true);
        try {
          const response = await fetch(`/api/datasets/${datasetId}/apply`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ decisions }),
          });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error ?? "Could not apply");
          setApplied(body);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Could not apply");
        } finally {
          setApplying(false);
        }
      }}
    />
  );
}

function ExportPanel({
  datasetId,
  summary,
  filename,
}: {
  datasetId: string;
  summary: ApplySummary;
  filename: string;
}) {
  return (
    <div className="bg-card mx-auto flex max-w-xl flex-col gap-5 rounded-xl border p-6 sm:p-8">
      <div>
        <span
          className="mb-4 flex size-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
          aria-hidden
        >
          <CheckCircle2 className="size-5" />
        </span>
        <h2 className="text-xl font-semibold">Applied to {filename}</h2>
        <p className="text-muted-foreground mt-2 text-pretty">
          {summary.cellsChanged} cells rewritten, {summary.rowsDeleted} rows
          removed, across {summary.rowsTouched} rows. All {summary.recorded}{" "}
          decisions were recorded in the audit log, rejections included.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button size="lg" asChild>
          <a href={`/api/datasets/${datasetId}/export?format=csv`} download>
            <Download className="size-4" aria-hidden />
            Download cleaned CSV
          </a>
        </Button>
        <Button size="lg" variant="outline" asChild>
          <a href={`/api/datasets/${datasetId}/export?format=audit`} download>
            <FileJson className="size-4" aria-hidden />
            Download audit log
          </a>
        </Button>
      </div>

      <p className="text-muted-foreground border-t pt-4 text-sm text-pretty">
        The audit log lists every decision with its before and after value, which
        detector proposed it, and whether a human accepted it. The same trail is
        browsable at{" "}
        <Link
          href={`/datasets/${datasetId}/trace`}
          className="underline underline-offset-2"
        >
          what the pipeline did
        </Link>
        .
      </p>
    </div>
  );
}
