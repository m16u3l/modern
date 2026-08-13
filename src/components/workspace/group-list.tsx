"use client";

import { Check, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { ReviewGroup } from "@/lib/review/state";

/**
 * The core product decision: a reviewer audits a handful of patterns and spot
 * checks inside each one. Rendering hundreds of loose cards would be unusable,
 * so suggestions are collapsed into groups with bulk actions.
 */
export function GroupList({
  groups,
  selectedKey,
  onSelect,
  onAcceptAll,
  onRejectAll,
}: {
  groups: ReviewGroup[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onAcceptAll: (group: ReviewGroup) => void;
  onRejectAll: (group: ReviewGroup) => void;
}) {
  return (
    <ul className="flex flex-col gap-2" role="list">
      {groups.map((group) => {
        const done = group.pending === 0;
        const heldBack = group.bulkAcceptable.length < group.pending;
        const selected = selectedKey === group.key;

        return (
          <li key={group.key}>
            <div
              className={cn(
                // The selected pattern gets a left rule rather than only a tint:
                // at a glance it is the one thing telling you where you are.
                "relative overflow-hidden rounded-xl border p-3.5 transition-colors",
                "before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:transition-colors",
                selected
                  ? "border-primary/50 bg-accent/50 before:bg-primary"
                  : "hover:bg-accent/25 before:bg-transparent",
                done && !selected && "opacity-60",
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(group.key)}
                className="w-full rounded-md text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                aria-current={selected}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium text-pretty">
                    {group.label}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums",
                      done
                        ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {done ? "done" : `${group.pending} left`}
                  </span>
                </div>
                <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
                  <span>{group.suggestions.length} suggestions</span>
                  {group.lowConfidence > 0 && (
                    <span
                      className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400"
                      title="Held back from bulk accept — low confidence or nothing to apply"
                    >
                      <TriangleAlert className="size-3.5" aria-hidden />
                      {group.lowConfidence} need a look
                    </span>
                  )}
                </div>
              </button>

              {!done && (
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={group.bulkAcceptable.length === 0}
                    onClick={() => onAcceptAll(group)}
                    title={
                      heldBack
                        ? `Accepts ${group.bulkAcceptable.length} of ${group.pending}; the rest are below the confidence threshold`
                        : undefined
                    }
                  >
                    <Check aria-hidden />
                    Accept all
                    {heldBack && ` (${group.bulkAcceptable.length})`}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onRejectAll(group)}>
                    <X aria-hidden />
                    Reject all
                  </Button>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
