import { describe, expect, it } from "vitest";
import {
  buildGroups,
  effectiveValue,
  initialReviewState,
  isBulkAcceptable,
  reviewReducer,
  statusOf,
  totals,
  type ReviewState,
} from "./state";
import { FIXTURE_SUGGESTIONS } from "@/lib/fixtures";
import { LOW_CONFIDENCE_THRESHOLD } from "@/lib/contracts";

function decide(
  state: ReviewState,
  ids: string[],
  status: "accepted" | "rejected" | "edited",
  finalValue?: string | null,
) {
  return reviewReducer(state, {
    type: "decide",
    suggestionIds: ids,
    status,
    finalValue,
    label: "test",
  });
}

describe("reviewReducer", () => {
  it("records a decision", () => {
    const state = decide(initialReviewState, ["sug-001"], "accepted");
    expect(statusOf(state, "sug-001")).toBe("accepted");
    expect(statusOf(state, "sug-002")).toBe("pending");
  });

  it("undoes a bulk decision in one step", () => {
    const ids = ["sug-001", "sug-002", "sug-003"];
    const accepted = decide(initialReviewState, ids, "accepted");
    const undone = reviewReducer(accepted, { type: "undo" });

    for (const id of ids) expect(statusOf(undone, id)).toBe("pending");
    expect(undone.history).toHaveLength(0);
  });

  it("restores the previous decision rather than clearing it", () => {
    const rejected = decide(initialReviewState, ["sug-001"], "rejected");
    const accepted = decide(rejected, ["sug-001"], "accepted");
    const undone = reviewReducer(accepted, { type: "undo" });

    expect(statusOf(undone, "sug-001")).toBe("rejected");
  });

  it("undoes repeatedly down to the initial state", () => {
    let state = decide(initialReviewState, ["sug-001"], "accepted");
    state = decide(state, ["sug-002"], "rejected");
    state = decide(state, ["sug-003"], "accepted");

    for (let i = 0; i < 3; i++) state = reviewReducer(state, { type: "undo" });

    expect(state.decisions).toEqual({});
    expect(totals(FIXTURE_SUGGESTIONS, state).pending).toBe(
      FIXTURE_SUGGESTIONS.length,
    );
  });

  it("is a no-op when there is nothing to undo", () => {
    expect(reviewReducer(initialReviewState, { type: "undo" })).toBe(
      initialReviewState,
    );
  });

  it("ignores an empty decision batch", () => {
    const state = decide(initialReviewState, [], "accepted");
    expect(state).toBe(initialReviewState);
  });

  it("uses the edited value over the proposed one", () => {
    const suggestion = FIXTURE_SUGGESTIONS[0];
    const state = decide(
      initialReviewState,
      [suggestion.id],
      "edited",
      "manual override",
    );

    expect(effectiveValue(state, suggestion)).toBe("manual override");
    expect(effectiveValue(initialReviewState, suggestion)).toBe(
      suggestion.proposedValue,
    );
  });
});

describe("buildGroups", () => {
  it("groups every suggestion exactly once", () => {
    const groups = buildGroups(FIXTURE_SUGGESTIONS, initialReviewState);
    const grouped = groups.flatMap((g) => g.suggestions);

    expect(grouped).toHaveLength(FIXTURE_SUGGESTIONS.length);
    expect(new Set(grouped.map((s) => s.id)).size).toBe(
      FIXTURE_SUGGESTIONS.length,
    );
  });

  it("produces a reviewable number of patterns, not one row per card", () => {
    const groups = buildGroups(FIXTURE_SUGGESTIONS, initialReviewState);
    expect(groups.length).toBeLessThan(FIXTURE_SUGGESTIONS.length / 3);
  });

  it("excludes low-confidence and no_action suggestions from bulk accept", () => {
    const groups = buildGroups(FIXTURE_SUGGESTIONS, initialReviewState);

    for (const group of groups) {
      for (const id of group.bulkAcceptable) {
        const suggestion = group.suggestions.find((s) => s.id === id)!;
        expect(suggestion.confidence).toBeGreaterThanOrEqual(
          LOW_CONFIDENCE_THRESHOLD,
        );
        expect(suggestion.action).not.toBe("no_action");
      }
    }

    const held = FIXTURE_SUGGESTIONS.filter((s) => !isBulkAcceptable(s));
    expect(held.length).toBeGreaterThan(0);
  });

  it("moves fully resolved groups behind the ones still pending", () => {
    const first = buildGroups(FIXTURE_SUGGESTIONS, initialReviewState)[0];
    const state = decide(
      initialReviewState,
      first.suggestions.map((s) => s.id),
      "accepted",
    );
    const groups = buildGroups(FIXTURE_SUGGESTIONS, state);

    expect(groups.at(-1)!.key).not.toBe(groups[0].key);
    expect(groups.find((g) => g.key === first.key)!.pending).toBe(0);
    expect(groups[0].pending).toBeGreaterThan(0);
  });

  it("reaches zero pending once every group is swept", () => {
    let state = initialReviewState;
    for (const group of buildGroups(FIXTURE_SUGGESTIONS, state)) {
      state = decide(
        state,
        group.suggestions.map((s) => s.id),
        "accepted",
      );
    }

    expect(totals(FIXTURE_SUGGESTIONS, state).pending).toBe(0);
  });
});
