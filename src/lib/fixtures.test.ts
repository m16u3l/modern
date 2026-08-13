import { describe, expect, it } from "vitest";
import {
  FIXTURE_ISSUES,
  FIXTURE_ROWS,
  FIXTURE_SUGGESTIONS,
  FIXTURE_SUMMARY,
  fixtureRow,
} from "./fixtures";
import {
  ISSUE_TYPES,
  LOW_CONFIDENCE_THRESHOLD,
  suggestionSchema,
  issueSchema,
  datasetSummarySchema,
} from "./contracts";

describe("fixtures", () => {
  it("every suggestion and issue satisfies its contract", () => {
    for (const suggestion of FIXTURE_SUGGESTIONS) {
      expect(() => suggestionSchema.parse(suggestion)).not.toThrow();
    }
    for (const issue of FIXTURE_ISSUES) {
      expect(() => issueSchema.parse(issue)).not.toThrow();
    }
    expect(() => datasetSummarySchema.parse(FIXTURE_SUMMARY)).not.toThrow();
  });

  it("covers every issue type at least three times", () => {
    for (const type of ISSUE_TYPES) {
      const issuesOfType = FIXTURE_ISSUES.filter((i) => i.type === type);
      expect(issuesOfType.length, `issue type ${type}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("spans the confidence range on both sides of the bulk-accept threshold", () => {
    const low = FIXTURE_SUGGESTIONS.filter(
      (s) => s.confidence < LOW_CONFIDENCE_THRESHOLD,
    );
    const high = FIXTURE_SUGGESTIONS.filter(
      (s) => s.confidence >= LOW_CONFIDENCE_THRESHOLD,
    );
    expect(low.length).toBeGreaterThanOrEqual(5);
    expect(high.length).toBeGreaterThanOrEqual(20);
  });

  it("references only rows that exist", () => {
    for (const suggestion of FIXTURE_SUGGESTIONS) {
      expect(fixtureRow(suggestion.rowId), suggestion.id).toBeDefined();
    }
    for (const issue of FIXTURE_ISSUES) {
      for (const id of issue.rowIds) {
        expect(fixtureRow(id), issue.id).toBeDefined();
      }
    }
  });

  it("reads currentValue off the referenced row", () => {
    const withColumn = FIXTURE_SUGGESTIONS.filter(
      (s) => s.columnKey && s.action !== "delete_row",
    );
    expect(withColumn.length).toBeGreaterThan(0);
    for (const suggestion of withColumn) {
      const raw = fixtureRow(suggestion.rowId)!.data[suggestion.columnKey!];
      const expected = raw === "" ? null : raw;
      expect(suggestion.currentValue, suggestion.id).toBe(expected);
    }
  });

  it("keeps the rules engine ahead of the LLM", () => {
    const byRule = FIXTURE_SUGGESTIONS.filter((s) => s.source === "rule").length;
    // The headline metric of the demo: most issues never reach a model.
    expect(byRule / FIXTURE_SUGGESTIONS.length).toBeGreaterThan(0.5);
  });

  it("has a row count matching the seeded table", () => {
    expect(FIXTURE_SUMMARY.rowCount).toBe(FIXTURE_ROWS.length);
    expect(FIXTURE_ROWS).toHaveLength(40);
  });
});
