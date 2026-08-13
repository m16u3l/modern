import { describe, expect, it } from "vitest";
import {
  computeColumnStats,
  detectCrossRow,
  detectExactDuplicates,
  detectFuzzyDuplicates,
  detectInconsistentFormat,
  detectMissingValues,
  detectOutliers,
  detectSuspiciousValues,
  detectTypeMismatch,
  profileDataset,
  ruleResolutionRate,
  splitFindings,
  type Finding,
} from "./index";
import { FIXTURE_ROWS } from "@/lib/fixtures";
import type { DataRow } from "@/lib/contracts";

const HEADERS = Object.keys(FIXTURE_ROWS[0].data);
const STATS = computeColumnStats(FIXTURE_ROWS, HEADERS);

function rowsOf(findings: Finding[]): string[] {
  return findings.map((f) => f.issue.rowIds[0]);
}

function forColumn(findings: Finding[], columnKey: string): Finding[] {
  return findings.filter((f) => f.issue.columnKey === columnKey);
}

/** Builds a tiny dataset inline so a test's input is visible in the test. */
function makeRows(headers: string[], cells: string[][]): DataRow[] {
  return cells.map((values, index) => ({
    id: `t-${index}`,
    rowIndex: index,
    data: Object.fromEntries(headers.map((h, i) => [h, values[i]])),
  }));
}

describe("computeColumnStats", () => {
  it("infers a type for every column", () => {
    const byKey = Object.fromEntries(STATS.map((s) => [s.key, s.inferredType]));

    expect(byKey.email).toBe("email");
    expect(byKey.phone).toBe("phone");
    expect(byKey.signup_date).toBe("date");
    expect(byKey.full_name).toBe("string");
    expect(byKey.revenue).toBe("number");
  });

  it("counts disguised nulls as missing", () => {
    const revenue = STATS.find((s) => s.key === "revenue")!;
    // "N/A" twice, "-" and "unknown" once each.
    expect(revenue.nullCount).toBe(4);
  });

  it("learns the dominant phone shape", () => {
    const phone = STATS.find((s) => s.key === "phone")!;
    expect(phone.majorityShape).toBe("(DDD) DDD-DDDD");
  });

  it("computes outlier fences only for numeric columns", () => {
    expect(STATS.find((s) => s.key === "revenue")!.fences).toBeDefined();
    expect(STATS.find((s) => s.key === "full_name")!.fences).toBeUndefined();
  });
});

describe("detectMissingValues", () => {
  const findings = detectMissingValues(FIXTURE_ROWS, STATS);

  it("proposes a null for placeholders and defers on empty cells", () => {
    const disguised = findings.filter((f) => f.suggestion);
    const empty = findings.filter((f) => f.ambiguous);

    expect(disguised.length).toBeGreaterThan(0);
    expect(empty.length).toBeGreaterThan(0);

    for (const finding of disguised) {
      expect(finding.suggestion!.proposedValue).toBeNull();
      expect(finding.suggestion!.source).toBe("rule");
    }
  });

  it("flags the empty email and phone cells", () => {
    expect(rowsOf(forColumn(findings, "email"))).toContain("r-12");
    expect(rowsOf(forColumn(findings, "phone"))).toContain("r-10");
  });

  it("never emits both a suggestion and an ambiguous flag", () => {
    for (const finding of findings) {
      expect(Boolean(finding.suggestion) && Boolean(finding.ambiguous)).toBe(false);
    }
  });
});

describe("detectExactDuplicates", () => {
  const findings = detectExactDuplicates(FIXTURE_ROWS, HEADERS);

  it("finds every byte-identical row and keeps the first", () => {
    expect(rowsOf(findings).sort()).toEqual(["r-06", "r-34", "r-36", "r-38"]);

    for (const finding of findings) {
      expect(finding.suggestion!.action).toBe("delete_row");
      expect(finding.suggestion!.confidence).toBeGreaterThan(0.95);
    }
  });

  it("reports the surviving row alongside the duplicate", () => {
    const first = findings.find((f) => f.issue.rowIds[0] === "r-06")!;
    expect(first.issue.rowIds[1]).toBe("r-05");
  });

  it("finds nothing in a table with no repeats", () => {
    const rows = makeRows(["a", "b"], [["1", "x"], ["2", "y"], ["3", "z"]]);
    expect(detectExactDuplicates(rows, ["a", "b"])).toHaveLength(0);
  });
});

describe("detectFuzzyDuplicates", () => {
  const findings = detectFuzzyDuplicates(FIXTURE_ROWS, HEADERS);

  it("catches near-identical records the exact hash misses", () => {
    const flagged = new Set(rowsOf(findings));
    // Accent-only, apostrophe-only and one-letter name differences.
    expect(flagged).toContain("r-39");
    expect(flagged).toContain("r-21");
    expect(flagged).toContain("r-29");
  });

  it("leaves the decision to a model rather than deleting rows itself", () => {
    for (const finding of findings) {
      expect(finding.ambiguous).toBe(true);
      expect(finding.suggestion).toBeUndefined();
    }
  });

  it("does not re-report rows already caught as exact duplicates", () => {
    const exact = new Set(rowsOf(detectExactDuplicates(FIXTURE_ROWS, HEADERS)));
    for (const id of rowsOf(findings)) {
      expect(exact.has(id), id).toBe(false);
    }
  });

  it("does not flag genuinely different rows", () => {
    const flagged = new Set(rowsOf(findings));
    expect(flagged.has("r-40")).toBe(false); // the one clean, unique row
  });

  it("stays well under the pair count of a full O(n^2) scan", () => {
    // Blocking is the whole point: 40 rows would be 780 exhaustive pairs.
    expect(findings.length).toBeLessThan(20);
  });
});

describe("detectInconsistentFormat", () => {
  const findings = detectInconsistentFormat(FIXTURE_ROWS, STATS);

  it("rewrites minority phone formats into the dominant shape", () => {
    const phone = forColumn(findings, "phone");
    const byRow = new Map(phone.map((f) => [f.issue.rowIds[0], f.suggestion!]));

    expect(byRow.get("r-03")?.proposedValue).toBe("(555) 010-4411");
    expect(byRow.get("r-05")?.proposedValue).toBe("(555) 010-7788");
  });

  it("converts non-ISO dates and marks the genuinely ambiguous ones", () => {
    const dates = forColumn(findings, "signup_date");
    const byRow = new Map(dates.map((f) => [f.issue.rowIds[0], f.suggestion!]));

    // 15 cannot be a month, so this one is safe to apply.
    expect(byRow.get("r-14")?.proposedValue).toBe("2024-06-15");
    expect(byRow.get("r-14")?.confidence).toBeGreaterThan(0.8);

    // 05/02 could be either reading, so confidence drops below bulk-accept.
    expect(byRow.get("r-03")?.confidence).toBeLessThan(0.7);
  });

  it("normalises casing drift to the dominant spelling", () => {
    const countries = forColumn(findings, "country");
    const byRow = new Map(countries.map((f) => [f.issue.rowIds[0], f.suggestion!]));

    expect(byRow.get("r-02")?.proposedValue).toBe("Mexico");
    expect(byRow.get("r-29")?.proposedValue).toBe("Brazil");

    const statuses = forColumn(findings, "status");
    expect(rowsOf(statuses).sort()).toEqual(["r-14", "r-19"]);
  });

  it("leaves values that already match the majority alone", () => {
    expect(rowsOf(forColumn(findings, "phone"))).not.toContain("r-01");
  });
});

describe("detectTypeMismatch", () => {
  const findings = detectTypeMismatch(FIXTURE_ROWS, STATS);

  it("normalises numbers that carry currency or separator noise", () => {
    const byRow = new Map(
      findings.filter((f) => f.suggestion).map((f) => [f.issue.rowIds[0], f.suggestion!]),
    );

    expect(byRow.get("r-23")?.proposedValue).toBe("2050.00");
    expect(byRow.get("r-16")?.proposedValue).toBe("4120.00");
    expect(byRow.get("r-31")?.proposedValue).toBe("1680.50");
  });

  it("defers to the model when nothing numeric can be recovered", () => {
    const abc = findings.find((f) => f.issue.rowIds[0] === "r-27")!;
    expect(abc.ambiguous).toBe(true);
    expect(abc.suggestion).toBeUndefined();
  });

  it("does not flag a clean number", () => {
    expect(rowsOf(findings)).not.toContain("r-01");
  });

  it("does not double-report an unpunctuated phone as a mismatch", () => {
    expect(rowsOf(forColumn(findings, "phone"))).not.toContain("r-03");
  });
});

describe("detectOutliers", () => {
  const findings = detectOutliers(FIXTURE_ROWS, STATS);

  it("flags the extreme revenue value", () => {
    expect(rowsOf(findings)).toContain("r-11");
  });

  it("reports rather than rewrites", () => {
    for (const finding of findings) {
      expect(finding.suggestion!.action).toBe("no_action");
      expect(finding.suggestion!.proposedValue).toBeNull();
    }
  });

  it("stays quiet on a column with no spread", () => {
    const rows = makeRows(
      ["n"],
      Array.from({ length: 12 }, () => ["100"]),
    );
    const stats = computeColumnStats(rows, ["n"]);
    expect(detectOutliers(rows, stats)).toHaveLength(0);
  });

  it("needs enough values before trusting quartiles", () => {
    const rows = makeRows(["n"], [["1"], ["2"], ["900"]]);
    const stats = computeColumnStats(rows, ["n"]);
    expect(detectOutliers(rows, stats)).toHaveLength(0);
  });
});

describe("detectSuspiciousValues", () => {
  const findings = detectSuspiciousValues(FIXTURE_ROWS, STATS);

  it("routes malformed emails to the model", () => {
    const emails = new Set(rowsOf(forColumn(findings, "email")));
    expect(emails).toContain("r-04"); // no TLD
    expect(emails).toContain("r-17"); // comma instead of a dot
    expect(emails).toContain("r-32"); // no TLD
  });

  it("catches placeholder names and filler phone numbers", () => {
    expect(rowsOf(forColumn(findings, "full_name"))).toContain("r-13");
    expect(rowsOf(forColumn(findings, "phone"))).toContain("r-13");
  });

  it("never proposes a replacement on its own", () => {
    for (const finding of findings) {
      expect(finding.ambiguous).toBe(true);
      expect(finding.suggestion).toBeUndefined();
    }
  });
});

describe("profileDataset", () => {
  const { findings } = profileDataset(FIXTURE_ROWS, HEADERS);

  it("splits findings into resolved and ambiguous with nothing left over", () => {
    const { resolved, ambiguous } = splitFindings(findings);
    expect(resolved.length + ambiguous.length).toBe(findings.length);
  });

  it("resolves most issues without a model", () => {
    // The headline claim of the architecture, asserted rather than asserted-in-prose.
    expect(ruleResolutionRate(findings)).toBeGreaterThan(0.5);
  });

  it("finds every issue type the seeded table contains", () => {
    const types = new Set(findings.map((f) => f.issue.type));
    for (const expected of [
      "missing_value",
      "exact_duplicate",
      "fuzzy_duplicate",
      "inconsistent_format",
      "type_mismatch",
      "outlier",
      "suspicious_value",
    ]) {
      expect(types.has(expected as never), expected).toBe(true);
    }
  });

  it("gives every finding human-readable evidence", () => {
    for (const finding of findings) {
      expect(finding.issue.evidence.length).toBeGreaterThan(10);
    }
  });

  it("is deterministic", () => {
    const again = profileDataset(FIXTURE_ROWS, HEADERS).findings;
    expect(JSON.stringify(again)).toBe(JSON.stringify(findings));
  });
});

describe("chunked profiling", () => {
  it("gives the same row-level findings chunked as in one pass", () => {
    const whole = detectMissingValues(FIXTURE_ROWS, STATS);

    const chunked: Finding[] = [];
    for (let i = 0; i < FIXTURE_ROWS.length; i += 7) {
      chunked.push(...detectMissingValues(FIXTURE_ROWS.slice(i, i + 7), STATS));
    }

    // Same set of findings regardless of how the rows were sliced, because the
    // column statistics are computed once and passed in.
    expect(new Set(rowsOf(chunked))).toEqual(new Set(rowsOf(whole)));
    expect(chunked).toHaveLength(whole.length);
  });

  it("keeps format detection stable across chunk boundaries", () => {
    const whole = detectInconsistentFormat(FIXTURE_ROWS, STATS);

    const chunked: Finding[] = [];
    for (let i = 0; i < FIXTURE_ROWS.length; i += 5) {
      chunked.push(
        ...detectInconsistentFormat(FIXTURE_ROWS.slice(i, i + 5), STATS),
      );
    }

    expect(chunked).toHaveLength(whole.length);
  });
});

describe("detectCrossRow", () => {
  it("combines both duplicate detectors", () => {
    const findings = detectCrossRow(FIXTURE_ROWS, HEADERS);
    const types = new Set(findings.map((f) => f.issue.type));

    expect(types).toContain("exact_duplicate");
    expect(types).toContain("fuzzy_duplicate");
  });
});
