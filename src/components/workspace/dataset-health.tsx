"use client";

import { Bot, Ruler } from "lucide-react";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { issueTypeLabel, type DatasetSummary, type IssueType } from "@/lib/contracts";
import type { ReviewTotals } from "@/lib/review/state";

export function DatasetHealth({
  summary,
  totals,
  ruleShare,
}: {
  summary: DatasetSummary;
  totals: ReviewTotals;
  /** Share of suggestions the deterministic engine produced without a model. */
  ruleShare: number;
}) {
  const reviewed = totals.total - totals.pending;
  const reviewProgress = totals.total === 0 ? 1 : reviewed / totals.total;

  const topIssues = (
    Object.entries(summary.issueCounts) as Array<[IssueType, number]>
  )
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <header className="bg-card rounded-xl border p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <h1 className="truncate font-mono text-lg font-medium">
            {summary.filename}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {summary.rowCount.toLocaleString()} rows · {summary.columns.length}{" "}
            columns · {(summary.completeness * 100).toFixed(1)}% complete
          </p>
        </div>

        <div className="flex w-full items-center justify-between gap-4 sm:w-auto sm:justify-end sm:gap-8">
          <Stat
            label="pending"
            value={totals.pending}
            tone={totals.pending === 0 ? "good" : "neutral"}
          />
          <Stat label="accepted" value={totals.accepted} />
          <Stat label="rejected" value={totals.rejected} />
          <Stat label="edited" value={totals.edited} />
        </div>
      </div>

      <div className="mt-5">
        <Progress value={reviewProgress * 100} className="h-2" />
        <p className="text-muted-foreground mt-2 text-sm">
          {reviewed} of {totals.total} suggestions reviewed
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-4 text-sm">
        <span
          className="text-muted-foreground inline-flex items-center gap-1.5"
          title="Issues the deterministic rules engine resolved without calling a model"
        >
          <Ruler className="size-4" aria-hidden />
          <span className="text-foreground font-medium">
            {(ruleShare * 100).toFixed(0)}%
          </span>
          solved by rules
        </span>
        <span
          className="text-muted-foreground inline-flex items-center gap-1.5"
          title="Only the ambiguous remainder reaches the LLM"
        >
          <Bot className="size-4" aria-hidden />
          <span className="text-foreground font-medium">
            {((1 - ruleShare) * 100).toFixed(0)}%
          </span>
          escalated to the LLM
        </span>

        <span className="bg-border h-4 w-px" aria-hidden />

        {topIssues.map(([type, count]) => (
          <span
            key={type}
            className="bg-muted text-muted-foreground rounded-full px-2.5 py-0.5 text-xs"
          >
            {issueTypeLabel(type)} {count}
          </span>
        ))}
      </div>
    </header>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "good";
}) {
  return (
    <div className="text-right">
      <div
        className={cn(
          "text-xl font-semibold tabular-nums",
          tone === "good" && "text-emerald-600 dark:text-emerald-400",
        )}
      >
        {value}
      </div>
      <div className="text-muted-foreground text-sm">{label}</div>
    </div>
  );
}
