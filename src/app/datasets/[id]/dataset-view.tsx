"use client";

import { useCallback, useEffect, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { ReviewWorkspace } from "@/components/workspace/review-workspace";
import {
  WorkspaceEmpty,
  WorkspaceError,
  WorkspaceSkeleton,
} from "@/components/workspace/states";
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

  return (
    <ReviewWorkspace
      summary={payload.summary}
      rows={payload.rows}
      issues={payload.issues}
      suggestions={payload.suggestions}
    />
  );
}
