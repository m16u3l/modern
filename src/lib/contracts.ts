import { z } from "zod";

/**
 * Shared contracts between the UI, the deterministic profiling engine and the
 * LLM port. Types are derived from the Zod schemas so a single declaration
 * serves as runtime validation, TypeScript type and LLM output schema.
 */

export const issueTypeSchema = z.enum([
  "missing_value",
  "exact_duplicate",
  "fuzzy_duplicate",
  "inconsistent_format",
  "type_mismatch",
  "outlier",
  "suspicious_value",
]);
export type IssueType = z.infer<typeof issueTypeSchema>;

export const ISSUE_TYPES = issueTypeSchema.options;

export const severitySchema = z.enum(["high", "medium", "low"]);
export type Severity = z.infer<typeof severitySchema>;

export const detectedBySchema = z.enum(["rule", "llm"]);
export type DetectedBy = z.infer<typeof detectedBySchema>;

export const inferredTypeSchema = z.enum([
  "string",
  "number",
  "date",
  "boolean",
  "email",
  "phone",
  "mixed",
]);
export type InferredType = z.infer<typeof inferredTypeSchema>;

export const suggestionActionSchema = z.enum([
  "set_value",
  "normalize_value",
  "delete_row",
  "merge_rows",
  "no_action",
]);
export type SuggestionAction = z.infer<typeof suggestionActionSchema>;

export const reviewStatusSchema = z.enum([
  "pending",
  "accepted",
  "rejected",
  "edited",
]);
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;

export const datasetStatusSchema = z.enum([
  "uploaded",
  "profiling",
  "enriching",
  "ready",
]);
export type DatasetStatus = z.infer<typeof datasetStatusSchema>;

export const issueSchema = z.object({
  id: z.string(),
  datasetId: z.string(),
  type: issueTypeSchema,
  severity: severitySchema,
  columnKey: z.string().optional(),
  rowIds: z.array(z.string()),
  detectedBy: detectedBySchema,
  /** Human-readable justification for why this was flagged. */
  evidence: z.string(),
});
export type Issue = z.infer<typeof issueSchema>;

export const suggestionSchema = z.object({
  id: z.string(),
  issueId: z.string(),
  datasetId: z.string(),
  action: suggestionActionSchema,
  rowId: z.string(),
  columnKey: z.string().optional(),
  currentValue: z.string().nullable(),
  proposedValue: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  source: detectedBySchema,
  /** Groups suggestions into reviewable patterns for bulk actions. */
  groupKey: z.string(),
});
export type Suggestion = z.infer<typeof suggestionSchema>;

export const reviewDecisionSchema = z.object({
  suggestionId: z.string(),
  status: reviewStatusSchema,
  finalValue: z.string().nullable().optional(),
  decidedAt: z.string(),
});
export type ReviewDecision = z.infer<typeof reviewDecisionSchema>;

export const columnProfileSchema = z.object({
  key: z.string(),
  inferredType: inferredTypeSchema,
  nullCount: z.number(),
  distinctCount: z.number(),
  sampleValues: z.array(z.string()),
});
export type ColumnProfile = z.infer<typeof columnProfileSchema>;

export const datasetSummarySchema = z.object({
  id: z.string(),
  filename: z.string(),
  rowCount: z.number(),
  columns: z.array(columnProfileSchema),
  issueCounts: z.record(issueTypeSchema, z.number()),
  completeness: z.number().min(0).max(1),
  status: datasetStatusSchema,
  progress: z.number().min(0).max(1),
});
export type DatasetSummary = z.infer<typeof datasetSummarySchema>;

/** A dataset row as stored: every cell kept as a string, parsing is deferred. */
export type DataRow = {
  id: string;
  rowIndex: number;
  data: Record<string, string>;
};

/**
 * Suggestions below this confidence are excluded from bulk-accept and flagged
 * in the UI. A reviewer should look at them one by one.
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.7;

/** Product decision for the demo, not a technical ceiling. Surfaced in the UI. */
export const MAX_DEMO_ROWS = 5000;

export function groupKeyFor(type: IssueType, columnKey?: string): string {
  return columnKey ? `${type}:${columnKey}` : type;
}

const ISSUE_TYPE_LABELS: Record<IssueType, string> = {
  missing_value: "Missing values",
  exact_duplicate: "Exact duplicates",
  fuzzy_duplicate: "Possible duplicates",
  inconsistent_format: "Inconsistent format",
  type_mismatch: "Type mismatch",
  outlier: "Outliers",
  suspicious_value: "Suspicious values",
};

export function issueTypeLabel(type: IssueType): string {
  return ISSUE_TYPE_LABELS[type];
}

export function describeGroup(type: IssueType, columnKey?: string): string {
  const label = issueTypeLabel(type);
  return columnKey ? `${label} · column "${columnKey}"` : label;
}
