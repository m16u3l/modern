import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { LOW_CONFIDENCE_THRESHOLD, type Suggestion } from "@/lib/contracts";

export function ValuePill({
  value,
  tone,
  struck = tone === "current",
  className,
}: {
  value: string | null;
  tone: "current" | "proposed";
  /** Strike-through is meaningful only when the value is being replaced. */
  struck?: boolean;
  className?: string;
}) {
  const isEmpty = value === null || value === "";

  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center truncate rounded-md border px-2 py-1 font-mono text-sm",
        tone === "current"
          ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
          : "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200",
        struck && !isEmpty && "line-through decoration-red-400",
        isEmpty && "italic opacity-70",
        className,
      )}
      title={value ?? "empty"}
    >
      {isEmpty ? "(empty)" : value}
    </span>
  );
}

/**
 * Cell-level diff: the current value struck through in red, the proposed value
 * in green. Actions that do not rewrite a cell say so explicitly instead of
 * rendering a misleading arrow.
 */
export function CellDiff({
  suggestion,
  proposedOverride,
}: {
  suggestion: Suggestion;
  proposedOverride?: string | null;
}) {
  const proposed =
    proposedOverride !== undefined ? proposedOverride : suggestion.proposedValue;

  if (suggestion.action === "delete_row") {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="rounded-md border border-red-200 bg-red-50 px-2 py-1 font-medium text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
          Delete this row
        </span>
      </div>
    );
  }

  if (suggestion.action === "no_action") {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <ValuePill value={suggestion.currentValue} tone="current" struck={false} />
        <span className="text-muted-foreground text-xs">
          flagged for review — no change proposed
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ValuePill value={suggestion.currentValue} tone="current" />
      <ArrowRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
      <ValuePill value={proposed} tone="proposed" />
    </div>
  );
}

export function ConfidenceBadge({ confidence }: { confidence: number }) {
  const low = confidence < LOW_CONFIDENCE_THRESHOLD;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-xs",
        low
          ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
          : "border-border bg-muted text-muted-foreground",
      )}
      title={
        low
          ? "Below the bulk-accept threshold — needs an individual decision"
          : "Confidence reported by the detector"
      }
    >
      {low && <span aria-hidden>!</span>}
      {(confidence * 100).toFixed(0)}%
    </span>
  );
}
