import {
  pgTable,
  uuid,
  text,
  integer,
  real,
  boolean,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { ColumnStats } from "@/lib/profiling/detectors";
import type {
  DatasetStatus,
  DetectedBy,
  InferredType,
  IssueType,
  ReviewStatus,
  Severity,
  SuggestionAction,
} from "@/lib/contracts";

/**
 * Enum-like columns are plain text with a `$type<>` narrowing rather than
 * pgEnum: the values are already validated by Zod at the boundary, and text
 * keeps migrations trivial when a new issue type is added.
 */

export const datasets = pgTable("datasets", {
  id: uuid("id").primaryKey().defaultRandom(),
  filename: text("filename").notNull(),
  blobUrl: text("blob_url"),
  rowCount: integer("row_count").notNull().default(0),
  // Column statistics are computed once from a sample and reused by every
  // chunk, so they have to survive between invocations.
  columns: jsonb("columns").$type<ColumnStats[]>().notNull().default([]),
  status: text("status").$type<DatasetStatus>().notNull().default("uploaded"),
  progress: real("progress").notNull().default(0),
  /** Rows already fed to the deterministic detectors. */
  profileCursor: integer("profile_cursor").notNull().default(0),
  /** Issues already sent to the LLM port. */
  enrichCursor: integer("enrich_cursor").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const rows = pgTable(
  "rows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    datasetId: uuid("dataset_id")
      .notNull()
      .references(() => datasets.id, { onDelete: "cascade" }),
    rowIndex: integer("row_index").notNull(),
    data: jsonb("data").$type<Record<string, string>>().notNull(),
    dirty: boolean("dirty").notNull().default(false),
  },
  (table) => [
    uniqueIndex("rows_dataset_row_idx").on(table.datasetId, table.rowIndex),
  ],
);

export const issues = pgTable(
  "issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    datasetId: uuid("dataset_id")
      .notNull()
      .references(() => datasets.id, { onDelete: "cascade" }),
    type: text("type").$type<IssueType>().notNull(),
    severity: text("severity").$type<Severity>().notNull(),
    columnKey: text("column_key"),
    rowIds: text("row_ids").array().notNull(),
    detectedBy: text("detected_by").$type<DetectedBy>().notNull(),
    evidence: text("evidence").notNull(),
    /** Set when the rules engine cannot resolve it and the LLM must weigh in. */
    ambiguous: boolean("ambiguous").notNull().default(false),
    inferredType: text("inferred_type").$type<InferredType>(),
  },
  (table) => [
    index("issues_dataset_type_idx").on(table.datasetId, table.type),
    index("issues_dataset_ambiguous_idx").on(table.datasetId, table.ambiguous),
  ],
);

export const suggestions = pgTable(
  "suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    datasetId: uuid("dataset_id")
      .notNull()
      .references(() => datasets.id, { onDelete: "cascade" }),
    action: text("action").$type<SuggestionAction>().notNull(),
    rowId: uuid("row_id").notNull(),
    columnKey: text("column_key"),
    currentValue: text("current_value"),
    proposedValue: text("proposed_value"),
    confidence: real("confidence").notNull(),
    rationale: text("rationale").notNull(),
    source: text("source").$type<DetectedBy>().notNull(),
    groupKey: text("group_key").notNull(),
    status: text("status").$type<ReviewStatus>().notNull().default("pending"),
    finalValue: text("final_value"),
  },
  (table) => [
    index("suggestions_dataset_group_idx").on(table.datasetId, table.groupKey),
    index("suggestions_dataset_status_idx").on(table.datasetId, table.status),
  ],
);

export const audit = pgTable(
  "audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    datasetId: uuid("dataset_id")
      .notNull()
      .references(() => datasets.id, { onDelete: "cascade" }),
    suggestionId: uuid("suggestion_id"),
    rowId: uuid("row_id"),
    columnKey: text("column_key"),
    action: text("action").$type<SuggestionAction>().notNull(),
    beforeState: jsonb("before_state").$type<Record<string, string> | null>(),
    afterState: jsonb("after_state").$type<Record<string, string> | null>(),
    source: text("source").$type<DetectedBy>().notNull(),
    reviewStatus: text("review_status").$type<ReviewStatus>().notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("audit_dataset_idx").on(table.datasetId)],
);

export const llmUsage = pgTable(
  "llm_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    datasetId: uuid("dataset_id")
      .notNull()
      .references(() => datasets.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cachedTokens: integer("cached_tokens").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("llm_usage_dataset_idx").on(table.datasetId)],
);
