"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, FileJson } from "lucide-react";
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
        <div className="bg-card rounded-lg border p-4">
          <p className="text-sm font-medium">{STAGE_LABELS[progress.stage]}</p>
          <Progress value={progress.progress * 100} className="mt-3 h-2" />
          {progress.detail && (
            <p className="text-muted-foreground mt-2 text-xs">{progress.detail}</p>
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
    <div className="mx-auto flex max-w-xl flex-col gap-4 rounded-lg border p-8">
      <div>
        <h2 className="text-lg font-semibold">Applied to {filename}</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {summary.cellsChanged} cells rewritten, {summary.rowsDeleted} rows
          removed, across {summary.rowsTouched} rows. All {summary.recorded}{" "}
          decisions were recorded in the audit log, rejections included.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <a href={`/api/datasets/${datasetId}/export?format=csv`} download>
            <Download className="size-4" aria-hidden />
            Download cleaned CSV
          </a>
        </Button>
        <Button variant="outline" asChild>
          <a href={`/api/datasets/${datasetId}/export?format=audit`} download>
            <FileJson className="size-4" aria-hidden />
            Download audit log
          </a>
        </Button>
      </div>

      <p className="text-muted-foreground text-xs">
        The audit log lists every decision with its before and after value, which
        detector proposed it, and whether a human accepted it.
      </p>
    </div>
  );
}
