import {
  LOW_CONFIDENCE_THRESHOLD,
  describeGroup,
  type IssueType,
  type ReviewDecision,
  type ReviewStatus,
  type Severity,
  type Suggestion,
} from "@/lib/contracts";

/**
 * Review state lives entirely on the client: decisions accumulate in memory and
 * are flushed in one batch. A request per click would make bulk actions on
 * hundreds of suggestions unusable.
 */

export type ReviewState = {
  decisions: Record<string, ReviewDecision>;
  /** Undo stack. `null` records a suggestion that had no decision yet. */
  history: Array<{
    label: string;
    previous: Record<string, ReviewDecision | null>;
  }>;
};

export type ReviewAction =
  | {
      type: "decide";
      suggestionIds: string[];
      status: ReviewStatus;
      finalValue?: string | null;
      label: string;
    }
  | { type: "undo" }
  | { type: "reset" };

export const initialReviewState: ReviewState = { decisions: {}, history: [] };

export function reviewReducer(
  state: ReviewState,
  action: ReviewAction,
): ReviewState {
  switch (action.type) {
    case "decide": {
      if (action.suggestionIds.length === 0) return state;

      const previous: Record<string, ReviewDecision | null> = {};
      const decisions = { ...state.decisions };
      const decidedAt = new Date().toISOString();

      for (const id of action.suggestionIds) {
        previous[id] = state.decisions[id] ?? null;
        decisions[id] = {
          suggestionId: id,
          status: action.status,
          finalValue: action.finalValue,
          decidedAt,
        };
      }

      return {
        decisions,
        history: [...state.history, { label: action.label, previous }],
      };
    }

    case "undo": {
      const last = state.history.at(-1);
      if (!last) return state;

      const decisions = { ...state.decisions };
      for (const [id, decision] of Object.entries(last.previous)) {
        if (decision === null) delete decisions[id];
        else decisions[id] = decision;
      }

      return { decisions, history: state.history.slice(0, -1) };
    }

    case "reset":
      return initialReviewState;
  }
}

export function statusOf(
  state: ReviewState,
  suggestionId: string,
): ReviewStatus {
  return state.decisions[suggestionId]?.status ?? "pending";
}

export function isResolved(state: ReviewState, suggestionId: string): boolean {
  return statusOf(state, suggestionId) !== "pending";
}

/** The value that would actually be written, honouring inline edits. */
export function effectiveValue(
  state: ReviewState,
  suggestion: Suggestion,
): string | null {
  const decision = state.decisions[suggestion.id];
  if (decision?.status === "edited" && decision.finalValue !== undefined) {
    return decision.finalValue;
  }
  return suggestion.proposedValue;
}

export type ReviewGroup = {
  key: string;
  type: IssueType;
  columnKey?: string;
  label: string;
  severity: Severity;
  suggestions: Suggestion[];
  pending: number;
  resolved: number;
  /** Suggestions held back from bulk accept because the model was unsure. */
  lowConfidence: number;
  /** Pending suggestions confident enough to be swept up by "Accept all". */
  bulkAcceptable: string[];
};

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

/** Only cell rewrites have a value a reviewer can override by hand. */
export function isEditable(suggestion: Suggestion): boolean {
  return (
    suggestion.action === "set_value" || suggestion.action === "normalize_value"
  );
}

export function isBulkAcceptable(suggestion: Suggestion): boolean {
  return (
    suggestion.confidence >= LOW_CONFIDENCE_THRESHOLD &&
    suggestion.action !== "no_action"
  );
}

export function buildGroups(
  suggestions: Suggestion[],
  state: ReviewState,
  severityByGroup: Record<string, Severity> = {},
): ReviewGroup[] {
  const byKey = new Map<string, Suggestion[]>();
  for (const suggestion of suggestions) {
    const bucket = byKey.get(suggestion.groupKey);
    if (bucket) bucket.push(suggestion);
    else byKey.set(suggestion.groupKey, [suggestion]);
  }

  const groups: ReviewGroup[] = [];

  for (const [key, items] of byKey) {
    const [type, columnKey] = splitGroupKey(key);
    const pending = items.filter((s) => !isResolved(state, s.id));

    groups.push({
      key,
      type,
      columnKey,
      label: describeGroup(type, columnKey),
      severity: severityByGroup[key] ?? "medium",
      suggestions: items,
      pending: pending.length,
      resolved: items.length - pending.length,
      lowConfidence: items.filter((s) => !isBulkAcceptable(s)).length,
      bulkAcceptable: pending.filter(isBulkAcceptable).map((s) => s.id),
    });
  }

  return groups.sort(
    (a, b) =>
      Number(b.pending > 0) - Number(a.pending > 0) ||
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      b.suggestions.length - a.suggestions.length ||
      a.label.localeCompare(b.label),
  );
}

function splitGroupKey(key: string): [IssueType, string | undefined] {
  const separator = key.indexOf(":");
  if (separator === -1) return [key as IssueType, undefined];
  return [
    key.slice(0, separator) as IssueType,
    key.slice(separator + 1) || undefined,
  ];
}

export type ReviewTotals = {
  total: number;
  pending: number;
  accepted: number;
  rejected: number;
  edited: number;
};

export function totals(
  suggestions: Suggestion[],
  state: ReviewState,
): ReviewTotals {
  const result: ReviewTotals = {
    total: suggestions.length,
    pending: 0,
    accepted: 0,
    rejected: 0,
    edited: 0,
  };

  for (const suggestion of suggestions) {
    result[statusOf(state, suggestion.id)] += 1;
  }

  return result;
}
