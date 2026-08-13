import { describe, expect, it } from "vitest";
import { materialise, planChanges, summarise, type Decision } from "./apply";
import type { Suggestion } from "./contracts";

function suggestion(overrides: Partial<Suggestion> = {}): Suggestion {
  return {
    id: "sug-1",
    issueId: "iss-1",
    datasetId: "ds-1",
    action: "normalize_value",
    rowId: "row-1",
    columnKey: "phone",
    currentValue: "5550104411",
    proposedValue: "(555) 010-4411",
    confidence: 0.95,
    rationale: "Same digits, different separators.",
    source: "rule",
    groupKey: "inconsistent_format:phone",
    ...overrides,
  };
}

const ROWS = new Map<string, Record<string, string>>([
  ["row-1", { name: "Carlos", phone: "5550104411", revenue: "N/A" }],
  ["row-2", { name: "Ana", phone: "(555) 010-2233", revenue: "1240.50" }],
]);

function decide(id: string, status: Decision["status"], finalValue = null) {
  return { suggestionId: id, status, finalValue };
}

describe("planChanges", () => {
  it("rewrites a cell for an accepted normalisation", () => {
    const [entry] = planChanges(
      [decide("sug-1", "accepted")],
      [suggestion()],
      ROWS,
    );

    expect(entry.change).toEqual({
      kind: "cell",
      rowId: "row-1",
      columnKey: "phone",
      before: "5550104411",
      after: "(555) 010-4411",
    });
  });

  it("uses the reviewer's override instead of the proposal when edited", () => {
    const [entry] = planChanges(
      [decide("sug-1", "edited", "+1 555 010 4411" as never)],
      [suggestion()],
      ROWS,
    );

    expect(entry.change).toMatchObject({ after: "+1 555 010 4411" });
    expect(entry.finalValue).toBe("+1 555 010 4411");
  });

  it("records a rejection without touching the data", () => {
    const [entry] = planChanges(
      [decide("sug-1", "rejected")],
      [suggestion()],
      ROWS,
    );

    expect(entry.change).toBeUndefined();
    expect(entry.status).toBe("rejected");
  });

  it("writes an empty cell when the proposal is a real null", () => {
    const [entry] = planChanges(
      [decide("sug-2", "accepted")],
      [
        suggestion({
          id: "sug-2",
          action: "set_value",
          columnKey: "revenue",
          currentValue: "N/A",
          proposedValue: null,
        }),
      ],
      ROWS,
    );

    expect(entry.change).toMatchObject({ before: "N/A", after: "" });
  });

  it("marks the row for deletion on an accepted duplicate", () => {
    const [entry] = planChanges(
      [decide("sug-3", "accepted")],
      [suggestion({ id: "sug-3", action: "delete_row", columnKey: undefined })],
      ROWS,
    );

    expect(entry.change).toEqual({ kind: "delete", rowId: "row-1" });
  });

  it("records an accepted no_action without a write", () => {
    const [entry] = planChanges(
      [decide("sug-4", "accepted")],
      [suggestion({ id: "sug-4", action: "no_action", proposedValue: null })],
      ROWS,
    );

    expect(entry.change).toBeUndefined();
    expect(entry.status).toBe("accepted");
  });

  it("treats a rewrite to the existing value as no change", () => {
    const [entry] = planChanges(
      [decide("sug-5", "accepted")],
      [
        suggestion({
          id: "sug-5",
          rowId: "row-2",
          proposedValue: "(555) 010-2233",
        }),
      ],
      ROWS,
    );

    expect(entry.change).toBeUndefined();
  });

  it("ignores decisions for suggestions that do not exist", () => {
    expect(planChanges([decide("nope", "accepted")], [suggestion()], ROWS)).toEqual(
      [],
    );
  });

  it("ignores a suggestion whose row is gone", () => {
    const planned = planChanges(
      [decide("sug-1", "accepted")],
      [suggestion({ rowId: "missing" })],
      ROWS,
    );

    expect(planned).toEqual([]);
  });

  it("applies each suggestion once even if decided twice", () => {
    const planned = planChanges(
      [decide("sug-1", "accepted"), decide("sug-1", "rejected")],
      [suggestion()],
      ROWS,
    );

    expect(planned).toHaveLength(1);
    expect(planned[0].status).toBe("accepted");
  });

  it("leaves pending decisions alone", () => {
    const [entry] = planChanges(
      [decide("sug-1", "pending")],
      [suggestion()],
      ROWS,
    );

    expect(entry.change).toBeUndefined();
  });
});

describe("summarise", () => {
  it("counts cells, deletions and rows touched", () => {
    const planned = planChanges(
      [
        decide("sug-1", "accepted"),
        decide("sug-2", "accepted"),
        decide("sug-3", "accepted"),
        decide("sug-4", "rejected"),
      ],
      [
        suggestion(),
        suggestion({
          id: "sug-2",
          action: "set_value",
          columnKey: "revenue",
          proposedValue: null,
        }),
        suggestion({
          id: "sug-3",
          rowId: "row-2",
          action: "delete_row",
          columnKey: undefined,
        }),
        suggestion({ id: "sug-4" }),
      ],
      ROWS,
    );

    // Both cell edits land on row-1, so it counts as one row touched.
    expect(summarise(planned)).toEqual({
      cellsChanged: 2,
      rowsDeleted: 1,
      rowsTouched: 2,
      recorded: 4,
    });
  });
});

describe("materialise", () => {
  it("turns a null proposal into an empty cell", () => {
    expect(materialise(null)).toBe("");
    expect(materialise("value")).toBe("value");
  });
});
