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

        return (
          <li key={group.key}>
            <div
              className={cn(
                "rounded-lg border p-3 transition-colors",
                selectedKey === group.key
                  ? "border-primary/60 bg-accent/40"
                  : "hover:bg-accent/20",
                done && "opacity-60",
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(group.key)}
                className="w-full text-left"
                aria-current={selectedKey === group.key}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium">{group.label}</span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 font-mono text-xs",
                      done
                        ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {done ? "done" : `${group.pending} left`}
                  </span>
                </div>
                <div className="text-muted-foreground mt-1 flex items-center gap-2 text-xs">
                  <span>{group.suggestions.length} suggestions</span>
                  {group.lowConfidence > 0 && (
                    <span
                      className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400"
                      title="Held back from bulk accept — low confidence or nothing to apply"
                    >
                      <TriangleAlert className="size-3" aria-hidden />
                      {group.lowConfidence} need a look
                    </span>
                  )}
                </div>
              </button>

              {!done && (
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    disabled={group.bulkAcceptable.length === 0}
                    onClick={() => onAcceptAll(group)}
                    title={
                      heldBack
                        ? `Accepts ${group.bulkAcceptable.length} of ${group.pending}; the rest are below the confidence threshold`
                        : undefined
                    }
                  >
                    <Check className="size-3" aria-hidden />
                    Accept all
                    {heldBack && ` (${group.bulkAcceptable.length})`}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => onRejectAll(group)}
                  >
                    <X className="size-3" aria-hidden />
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
