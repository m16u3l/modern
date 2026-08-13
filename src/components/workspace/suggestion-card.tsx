"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Check, Pencil, Ruler, Undo2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  DataRow,
  Issue,
  ReviewStatus,
  Suggestion,
} from "@/lib/contracts";
import { isEditable } from "@/lib/review/state";
import { CellDiff, ConfidenceBadge } from "./diff";

const STATUS_STYLES: Record<ReviewStatus, string> = {
  pending: "",
  accepted: "border-emerald-300 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/20",
  rejected: "border-border bg-muted/50 opacity-60",
  edited: "border-blue-300 bg-blue-50/40 dark:border-blue-900 dark:bg-blue-950/20",
};

const STATUS_LABELS: Record<ReviewStatus, string> = {
  pending: "",
  accepted: "Accepted",
  rejected: "Rejected",
  edited: "Edited",
};

export function SuggestionCard({
  suggestion,
  issue,
  row,
  columnOrder,
  status,
  finalValue,
  focused,
  onAccept,
  onReject,
  onEdit,
  onReset,
  onFocus,
  editing,
  onEditingChange,
}: {
  suggestion: Suggestion;
  issue?: Issue;
  row?: DataRow;
  columnOrder: string[];
  status: ReviewStatus;
  finalValue: string | null;
  focused: boolean;
  onAccept: () => void;
  onReject: () => void;
  onEdit: (value: string) => void;
  onReset: () => void;
  onFocus: () => void;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focused) {
      ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [focused]);

  const canEdit = isEditable(suggestion);

  return (
    <div
      ref={ref}
      onClick={onFocus}
      className={cn(
        "rounded-lg border p-4 transition-colors",
        STATUS_STYLES[status],
        focused && "ring-primary/60 ring-2 ring-offset-1",
      )}
      data-testid="suggestion-card"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
          {suggestion.source === "llm" ? (
            <Bot className="size-3.5" aria-hidden />
          ) : (
            <Ruler className="size-3.5" aria-hidden />
          )}
          {suggestion.source === "llm" ? "LLM" : "Rule"}
        </span>
        <ConfidenceBadge confidence={suggestion.confidence} />
        {row && (
          <span className="text-muted-foreground font-mono text-xs">
            row {row.rowIndex + 1}
          </span>
        )}
        {status !== "pending" && (
          <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium">
            {STATUS_LABELS[status]}
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1.5"
              onClick={(event) => {
                event.stopPropagation();
                onReset();
              }}
            >
              <Undo2 className="size-3.5" aria-hidden />
              <span className="sr-only">Reset decision</span>
            </Button>
          </span>
        )}
      </div>

      {editing ? (
        <InlineEditor
          initialValue={finalValue ?? ""}
          onCommit={(value) => {
            onEdit(value);
            onEditingChange(false);
          }}
          onCancel={() => onEditingChange(false)}
        />
      ) : (
        <CellDiff
          suggestion={suggestion}
          proposedOverride={status === "edited" ? finalValue : undefined}
        />
      )}

      <p className="text-muted-foreground mt-3 text-sm">
        {suggestion.rationale}
      </p>

      {issue && (
        <p className="text-muted-foreground/80 mt-1 text-xs">
          Detected because: {issue.evidence}
        </p>
      )}

      {row && (
        <RowContext
          row={row}
          columnOrder={columnOrder}
          highlight={suggestion.columnKey}
        />
      )}

      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          variant={status === "accepted" ? "default" : "outline"}
          onClick={(event) => {
            event.stopPropagation();
            onAccept();
          }}
        >
          <Check className="size-4" aria-hidden />
          Accept
        </Button>
        <Button
          size="sm"
          variant={status === "rejected" ? "secondary" : "outline"}
          onClick={(event) => {
            event.stopPropagation();
            onReject();
          }}
        >
          <X className="size-4" aria-hidden />
          Reject
        </Button>
        {canEdit && (
          <Button
            size="sm"
            variant="ghost"
            onClick={(event) => {
              event.stopPropagation();
              onEditingChange(true);
            }}
          >
            <Pencil className="size-4" aria-hidden />
            Edit
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Mounted only while editing, so its draft starts from the current value
 * without an effect syncing props into state.
 */
function InlineEditor({
  initialValue,
  onCommit,
  onCancel,
}: {
  initialValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        ref={inputRef}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") onCommit(draft);
          if (event.key === "Escape") onCancel();
        }}
        className="max-w-xs font-mono"
        aria-label="Override the proposed value"
      />
      <Button size="sm" onClick={() => onCommit(draft)}>
        Save
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

/** The rest of the row, so a reviewer can tell who this record actually is. */
function RowContext({
  row,
  columnOrder,
  highlight,
}: {
  row: DataRow;
  columnOrder: string[];
  highlight?: string;
}) {
  return (
    <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-xs">
      {/* Driven by the dataset's column order, never by the row's own keys:
          those come back from jsonb reordered, which would show the reviewer a
          record whose fields are scrambled. */}
      {columnOrder.map((key) => (
        <div key={key} className="flex gap-1">
          <dt
            className={cn(
              "text-muted-foreground",
              key === highlight && "text-foreground font-medium",
            )}
          >
            {key}
          </dt>
          <dd
            className={cn(
              "font-mono",
              key === highlight ? "text-foreground font-medium" : "text-muted-foreground",
            )}
          >
            {row.data[key] ? row.data[key] : "—"}
          </dd>
        </div>
      ))}
    </dl>
  );
}
