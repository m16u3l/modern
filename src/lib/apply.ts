import type { ReviewStatus, Suggestion } from "@/lib/contracts";

/**
 * Deciding what a decision does to a row is pure logic, so it lives here rather
 * than inside the route handler and is tested without a database.
 */

export type Decision = {
  suggestionId: string;
  status: ReviewStatus;
  /** The reviewer's override, when they edited the proposal. */
  finalValue: string | null;
};

export type RowChange =
  | {
      kind: "cell";
      rowId: string;
      columnKey: string;
      before: string;
      after: string;
    }
  | { kind: "delete"; rowId: string };

export type PlannedChange = {
  suggestion: Suggestion;
  status: ReviewStatus;
  /** Absent when the decision changes nothing (rejected, or no_action). */
  change?: RowChange;
  finalValue: string | null;
};

/**
 * A null proposal means "this cell should be empty" — that is the whole point of
 * replacing a disguised null like "N/A". Rows store strings, so it lands as "".
 */
export function materialise(value: string | null): string {
  return value ?? "";
}

export function planChanges(
  decisions: Decision[],
  suggestions: Suggestion[],
  rows: Map<string, Record<string, string>>,
): PlannedChange[] {
  const byId = new Map(suggestions.map((s) => [s.id, s]));
  const planned: PlannedChange[] = [];
  const seen = new Set<string>();

  for (const decision of decisions) {
    const suggestion = byId.get(decision.suggestionId);
    if (!suggestion || seen.has(decision.suggestionId)) continue;
    seen.add(decision.suggestionId);

    const finalValue =
      decision.status === "edited" ? decision.finalValue : suggestion.proposedValue;

    // Only an accepted or edited decision touches the data. A rejection is
    // still recorded — knowing what a reviewer turned down is the point of an
    // audit log.
    if (decision.status !== "accepted" && decision.status !== "edited") {
      planned.push({ suggestion, status: decision.status, finalValue });
      continue;
    }

    const row = rows.get(suggestion.rowId);
    if (!row) continue;

    if (suggestion.action === "delete_row") {
      planned.push({
        suggestion,
        status: decision.status,
        finalValue,
        change: { kind: "delete", rowId: suggestion.rowId },
      });
      continue;
    }

    if (
      (suggestion.action === "set_value" ||
        suggestion.action === "normalize_value") &&
      suggestion.columnKey
    ) {
      const before = row[suggestion.columnKey] ?? "";
      const after = materialise(finalValue);

      planned.push({
        suggestion,
        status: decision.status,
        finalValue,
        // A rewrite to the value already there is not a change.
        change:
          before === after
            ? undefined
            : {
                kind: "cell",
                rowId: suggestion.rowId,
                columnKey: suggestion.columnKey,
                before,
                after,
              },
      });
      continue;
    }

    // no_action accepted means "I looked, leave it alone"; merge_rows is never
    // produced by the current detectors. Both are recorded, neither writes.
    planned.push({ suggestion, status: decision.status, finalValue });
  }

  return planned;
}

export type ApplySummary = {
  cellsChanged: number;
  rowsDeleted: number;
  rowsTouched: number;
  recorded: number;
};

export function summarise(planned: PlannedChange[]): ApplySummary {
  const touched = new Set<string>();
  let cellsChanged = 0;
  let rowsDeleted = 0;

  for (const entry of planned) {
    if (!entry.change) continue;
    touched.add(entry.change.rowId);
    if (entry.change.kind === "delete") rowsDeleted++;
    else cellsChanged++;
  }

  return {
    cellsChanged,
    rowsDeleted,
    rowsTouched: touched.size,
    recorded: planned.length,
  };
}
