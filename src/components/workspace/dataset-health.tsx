"use client";

import { Bot, Ruler } from "lucide-react";
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
    <header className="bg-card rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div>
          <h1 className="font-mono text-lg font-semibold">{summary.filename}</h1>
          <p className="text-muted-foreground text-sm">
            {summary.rowCount.toLocaleString()} rows ·{" "}
            {summary.columns.length} columns ·{" "}
            {(summary.completeness * 100).toFixed(1)}% complete
          </p>
        </div>

        <div className="flex items-center gap-6">
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

      <div className="mt-3">
        <Progress value={reviewProgress * 100} className="h-2" />
        <p className="text-muted-foreground mt-1 text-xs">
          {reviewed} of {totals.total} suggestions reviewed
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
        <span
          className="text-muted-foreground inline-flex items-center gap-1 text-xs"
          title="Issues the deterministic rules engine resolved without calling a model"
        >
          <Ruler className="size-3.5" aria-hidden />
          {(ruleShare * 100).toFixed(0)}% solved by rules
        </span>
        <span
          className="text-muted-foreground inline-flex items-center gap-1 text-xs"
          title="Only the ambiguous remainder reaches the LLM"
        >
          <Bot className="size-3.5" aria-hidden />
          {((1 - ruleShare) * 100).toFixed(0)}% escalated to the LLM
        </span>

        <span className="text-muted-foreground/50 mx-1">|</span>

        {topIssues.map(([type, count]) => (
          <span
            key={type}
            className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs"
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
        className={
          tone === "good"
            ? "font-mono text-xl font-semibold text-emerald-600 dark:text-emerald-400"
            : "font-mono text-xl font-semibold"
        }
      >
        {value}
      </div>
      <div className="text-muted-foreground text-xs">{label}</div>
    </div>
  );
}
