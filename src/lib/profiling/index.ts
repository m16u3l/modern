import type { DataRow } from "@/lib/contracts";
import {
  computeColumnStats,
  detectExactDuplicates,
  detectFuzzyDuplicates,
  detectInconsistentFormat,
  detectMissingValues,
  detectOutliers,
  detectSuspiciousValues,
  detectTypeMismatch,
  type ColumnStats,
  type Finding,
} from "./detectors";

export * from "./detectors";
export * from "./values";

/**
 * Detectors that only need one row plus the column statistics. These run per
 * chunk, so a 5k-row file never sits in a single serverless invocation.
 */
export function detectRowLevel(
  rows: DataRow[],
  columns: ColumnStats[],
): Finding[] {
  return [
    ...detectMissingValues(rows, columns),
    ...detectInconsistentFormat(rows, columns),
    ...detectTypeMismatch(rows, columns),
    ...detectOutliers(rows, columns),
    ...detectSuspiciousValues(rows, columns),
  ];
}

/**
 * Detectors that need to see every row at once. They run as a single final pass
 * after chunking. At the demo's 5k-row cap this comfortably fits one
 * invocation; past that it is the first thing that would move to a worker.
 */
export function detectCrossRow(
  rows: DataRow[],
  headers: string[],
): Finding[] {
  return [
    ...detectExactDuplicates(rows, headers),
    ...detectFuzzyDuplicates(rows, headers),
  ];
}

/** Whole-dataset run. Used by tests and by any caller small enough to skip chunking. */
export function profileDataset(
  rows: DataRow[],
  headers: string[],
): { columns: ColumnStats[]; findings: Finding[] } {
  const columns = computeColumnStats(rows, headers);
  return {
    columns,
    findings: [
      ...detectRowLevel(rows, columns),
      ...detectCrossRow(rows, headers),
    ],
  };
}

export type FindingSplit = {
  /** Findings the rules engine resolved on its own. */
  resolved: Finding[];
  /** Findings that need a model's judgement. */
  ambiguous: Finding[];
};

export function splitFindings(findings: Finding[]): FindingSplit {
  return {
    resolved: findings.filter((finding) => finding.suggestion !== undefined),
    ambiguous: findings.filter((finding) => finding.ambiguous === true),
  };
}

/**
 * The headline metric of the whole design: the share of issues that never
 * reach a model. Surfaced in the UI and quoted in the README.
 */
export function ruleResolutionRate(findings: Finding[]): number {
  if (findings.length === 0) return 1;
  return splitFindings(findings).resolved.length / findings.length;
}
