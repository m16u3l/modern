"use client";

import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type {
  DataRow,
  DatasetSummary,
  Issue,
  ReviewStatus,
  Suggestion,
} from "@/lib/contracts";
import {
  buildGroups,
  initialReviewState,
  isEditable,
  isResolved,
  reviewReducer,
  statusOf,
  totals,
  type ReviewGroup,
} from "@/lib/review/state";
import { DatasetHealth } from "./dataset-health";
import { GroupList } from "./group-list";
import { SuggestionCard } from "./suggestion-card";

export function ReviewWorkspace({
  summary,
  rows,
  issues,
  suggestions,
  onApply,
  applying = false,
}: {
  summary: DatasetSummary;
  rows: DataRow[];
  issues: Issue[];
  suggestions: Suggestion[];
  onApply?: (decisions: ReturnType<typeof buildDecisionList>) => void;
  applying?: boolean;
}) {
  const [state, dispatch] = useReducer(reviewReducer, initialReviewState);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const rowsById = useMemo(
    () => new Map(rows.map((row) => [row.id, row])),
    [rows],
  );
  const issuesById = useMemo(
    () => new Map(issues.map((issue) => [issue.id, issue])),
    [issues],
  );

  // Group severity comes from the issues, so the sidebar can rank patterns.
  const severityByGroup = useMemo(() => {
    const map: Record<string, "high" | "medium" | "low"> = {};
    const rank = { high: 0, medium: 1, low: 2 } as const;
    for (const suggestion of suggestions) {
      const severity = issuesById.get(suggestion.issueId)?.severity;
      if (!severity) continue;
      const current = map[suggestion.groupKey];
      if (!current || rank[severity] < rank[current]) {
        map[suggestion.groupKey] = severity;
      }
    }
    return map;
  }, [suggestions, issuesById]);

  const groups = useMemo(
    () => buildGroups(suggestions, state, severityByGroup),
    [suggestions, state, severityByGroup],
  );

  const counts = useMemo(
    () => totals(suggestions, state),
    [suggestions, state],
  );

  const ruleShare = useMemo(() => {
    if (suggestions.length === 0) return 0;
    return (
      suggestions.filter((s) => s.source === "rule").length / suggestions.length
    );
  }, [suggestions]);

  const activeGroup: ReviewGroup | undefined =
    groups.find((group) => group.key === selectedKey) ?? groups[0];

  // The cursor is derived rather than stored: when the visible group changes,
  // a stale id simply falls back to that group's first suggestion.
  const focused =
    focusedId && activeGroup?.suggestions.some((s) => s.id === focusedId)
      ? focusedId
      : (activeGroup?.suggestions[0]?.id ?? null);

  const decide = useCallback(
    (
      suggestionIds: string[],
      status: ReviewStatus,
      label: string,
      finalValue?: string | null,
    ) => {
      if (suggestionIds.length === 0) return;
      dispatch({ type: "decide", suggestionIds, status, finalValue, label });

      if (suggestionIds.length > 1) {
        toast.success(label, {
          action: { label: "Undo", onClick: () => dispatch({ type: "undo" }) },
        });
      }
    },
    [],
  );

  /** After a decision, jump to the next thing that still needs one. */
  const advance = useCallback(
    (fromId: string) => {
      if (!activeGroup) return;
      const rest = activeGroup.suggestions.slice(
        activeGroup.suggestions.findIndex((s) => s.id === fromId) + 1,
      );
      const nextInGroup = rest.find((s) => !isResolved(state, s.id));
      if (nextInGroup) {
        setFocusedId(nextInGroup.id);
        return;
      }

      const nextGroup = groups.find(
        (group) => group.key !== activeGroup.key && group.pending > 0,
      );
      if (nextGroup) {
        setSelectedKey(nextGroup.key);
        setFocusedId(
          nextGroup.suggestions.find((s) => !isResolved(state, s.id))?.id ??
            null,
        );
      }
    },
    [activeGroup, groups, state],
  );

  const move = useCallback(
    (delta: 1 | -1) => {
      if (!activeGroup || !focused) return;
      const index = activeGroup.suggestions.findIndex((s) => s.id === focused);
      const next = index + delta;

      if (next >= 0 && next < activeGroup.suggestions.length) {
        setFocusedId(activeGroup.suggestions[next].id);
        return;
      }

      // Roll over into the adjacent group so the whole review is one list.
      const groupIndex = groups.findIndex((g) => g.key === activeGroup.key);
      const neighbour = groups[groupIndex + delta];
      if (!neighbour) return;

      setSelectedKey(neighbour.key);
      setFocusedId(
        delta === 1
          ? (neighbour.suggestions[0]?.id ?? null)
          : (neighbour.suggestions.at(-1)?.id ?? null),
      );
    },
    [activeGroup, focused, groups],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        dispatch({ type: "undo" });
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.key) {
        case "ArrowDown":
        case "j":
          event.preventDefault();
          move(1);
          break;
        case "ArrowUp":
        case "k":
          event.preventDefault();
          move(-1);
          break;
        case "a":
        case "A":
          if (!focused) break;
          event.preventDefault();
          decide([focused], "accepted", "Accepted 1 suggestion");
          advance(focused);
          break;
        case "r":
        case "R":
          if (!focused) break;
          event.preventDefault();
          decide([focused], "rejected", "Rejected 1 suggestion");
          advance(focused);
          break;
        case "e":
        case "E": {
          if (!focused) break;
          const current = activeGroup?.suggestions.find((s) => s.id === focused);
          // Deletes and merges have no cell value to override.
          if (!current || !isEditable(current)) break;
          event.preventDefault();
          setEditingId(focused);
          break;
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [move, decide, advance, focused, activeGroup]);

  const allDone = counts.pending === 0 && counts.total > 0;

  return (
    <div className="flex flex-col gap-4">
      <DatasetHealth summary={summary} totals={counts} ruleShare={ruleShare} />

      <div className="grid gap-4 lg:grid-cols-[minmax(280px,340px)_1fr]">
        <aside className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              {groups.length} patterns to review
            </h2>
            {state.history.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => dispatch({ type: "undo" })}
              >
                Undo
              </Button>
            )}
          </div>
          <ScrollArea className="h-[calc(100vh-20rem)] pr-3">
            <GroupList
              groups={groups}
              selectedKey={activeGroup?.key ?? null}
              onSelect={(key) => {
                setSelectedKey(key);
                setEditingId(null);
              }}
              onAcceptAll={(group) =>
                decide(
                  group.bulkAcceptable,
                  "accepted",
                  `Accepted ${group.bulkAcceptable.length} in "${group.label}"`,
                )
              }
              onRejectAll={(group) =>
                decide(
                  group.suggestions
                    .filter((s) => !isResolved(state, s.id))
                    .map((s) => s.id),
                  "rejected",
                  `Rejected ${group.pending} in "${group.label}"`,
                )
              }
            />
          </ScrollArea>
        </aside>

        <section className="flex flex-col gap-3">
          {allDone && (
            <div className="flex items-center justify-between gap-4 rounded-lg border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
              <p className="flex items-center gap-2 text-sm font-medium text-emerald-900 dark:text-emerald-200">
                <CheckCircle2 className="size-4" aria-hidden />
                Every suggestion has a decision. {counts.accepted} accepted,{" "}
                {counts.edited} edited, {counts.rejected} rejected.
              </p>
              {onApply && (
                <Button
                  onClick={() => onApply(buildDecisionList(state, suggestions))}
                  disabled={applying}
                >
                  {applying ? "Applying…" : "Apply & export"}
                </Button>
              )}
            </div>
          )}

          {activeGroup ? (
            <>
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="font-semibold">{activeGroup.label}</h2>
                <p className="text-muted-foreground text-xs">
                  {activeGroup.pending} pending · {activeGroup.resolved} resolved
                </p>
              </div>

              <ScrollArea className="h-[calc(100vh-22rem)] pr-3">
                <div className="flex flex-col gap-3">
                  {activeGroup.suggestions.map((suggestion) => (
                    <SuggestionCard
                      key={suggestion.id}
                      suggestion={suggestion}
                      issue={issuesById.get(suggestion.issueId)}
                      row={rowsById.get(suggestion.rowId)}
                      status={statusOf(state, suggestion.id)}
                      finalValue={
                        state.decisions[suggestion.id]?.finalValue ??
                        suggestion.proposedValue
                      }
                      focused={focused === suggestion.id}
                      editing={editingId === suggestion.id}
                      onEditingChange={(editing) =>
                        setEditingId(editing ? suggestion.id : null)
                      }
                      onFocus={() => setFocusedId(suggestion.id)}
                      onAccept={() => {
                        decide([suggestion.id], "accepted", "Accepted 1 suggestion");
                        advance(suggestion.id);
                      }}
                      onReject={() => {
                        decide([suggestion.id], "rejected", "Rejected 1 suggestion");
                        advance(suggestion.id);
                      }}
                      onEdit={(value) =>
                        decide(
                          [suggestion.id],
                          "edited",
                          "Edited 1 suggestion",
                          value,
                        )
                      }
                      onReset={() =>
                        dispatch({
                          type: "decide",
                          suggestionIds: [suggestion.id],
                          status: "pending",
                          label: "Reset",
                        })
                      }
                    />
                  ))}
                </div>
              </ScrollArea>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              No suggestions to review.
            </p>
          )}

          <ShortcutLegend />
        </section>
      </div>
    </div>
  );
}

function ShortcutLegend() {
  const shortcuts: Array<[string, string]> = [
    ["A", "accept"],
    ["R", "reject"],
    ["E", "edit"],
    ["↑ ↓", "navigate"],
    ["⌘Z", "undo"],
  ];

  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-3 border-t pt-2 text-xs">
      {shortcuts.map(([key, label]) => (
        <span key={key} className="inline-flex items-center gap-1">
          <kbd className="bg-muted rounded border px-1.5 py-0.5 font-mono">
            {key}
          </kbd>
          {label}
        </span>
      ))}
    </div>
  );
}

/** Flattens client-side state into the payload the apply endpoint expects. */
export function buildDecisionList(
  state: { decisions: Record<string, { status: ReviewStatus; finalValue?: string | null }> },
  suggestions: Suggestion[],
) {
  return suggestions
    .map((suggestion) => {
      const decision = state.decisions[suggestion.id];
      if (!decision || decision.status === "pending") return null;
      return {
        suggestionId: suggestion.id,
        status: decision.status,
        finalValue:
          decision.status === "edited"
            ? (decision.finalValue ?? null)
            : suggestion.proposedValue,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}
