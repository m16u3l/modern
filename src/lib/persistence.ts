import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import {
  groupKeyFor,
  type DataRow,
  type DatasetStatus,
  type DatasetSummary,
  type Issue,
  type IssueType,
  type Suggestion,
  ISSUE_TYPES,
} from "@/lib/contracts";
import type { Finding } from "@/lib/profiling";
import { isMissing } from "@/lib/profiling/values";

/**
 * Translates between the pure engine's `Finding` shape and the database. The
 * detectors never learn that a database exists; this file is the only place
 * that knows both sides.
 */

export async function persistFindings(
  datasetId: string,
  findings: Finding[],
): Promise<void> {
  if (findings.length === 0) return;
  const db = getDb();

  await db.transaction(async (tx) => {
    const insertedIssues = await tx
      .insert(schema.issues)
      .values(
        findings.map((finding) => ({
          datasetId,
          type: finding.issue.type,
          severity: finding.issue.severity,
          columnKey: finding.issue.columnKey ?? null,
          rowIds: finding.issue.rowIds,
          detectedBy: finding.issue.detectedBy,
          evidence: finding.issue.evidence,
          ambiguous: finding.ambiguous === true,
        })),
      )
      .returning({ id: schema.issues.id });

    const suggestions = findings.flatMap((finding, index) => {
      if (!finding.suggestion) return [];
      return [
        {
          issueId: insertedIssues[index].id,
          datasetId,
          action: finding.suggestion.action,
          rowId: finding.suggestion.rowId,
          columnKey: finding.suggestion.columnKey ?? null,
          currentValue: finding.suggestion.currentValue,
          proposedValue: finding.suggestion.proposedValue,
          confidence: finding.suggestion.confidence,
          rationale: finding.suggestion.rationale,
          source: finding.suggestion.source,
          groupKey: groupKeyFor(finding.issue.type, finding.issue.columnKey),
        },
      ];
    });

    if (suggestions.length > 0) {
      await tx.insert(schema.suggestions).values(suggestions);
    }
  });
}

export async function loadRows(
  datasetId: string,
  options: { offset?: number; limit?: number } = {},
): Promise<DataRow[]> {
  const db = getDb();
  const query = db
    .select({
      id: schema.rows.id,
      rowIndex: schema.rows.rowIndex,
      data: schema.rows.data,
    })
    .from(schema.rows)
    .where(eq(schema.rows.datasetId, datasetId))
    .orderBy(schema.rows.rowIndex);

  if (options.limit !== undefined) {
    return query.limit(options.limit).offset(options.offset ?? 0);
  }
  return query;
}

export async function loadSuggestions(
  datasetId: string,
): Promise<Suggestion[]> {
  const db = getDb();
  const records = await db
    .select()
    .from(schema.suggestions)
    .where(eq(schema.suggestions.datasetId, datasetId))
    .orderBy(schema.suggestions.groupKey);

  return records.map((record) => ({
    id: record.id,
    issueId: record.issueId,
    datasetId: record.datasetId,
    action: record.action,
    rowId: record.rowId,
    columnKey: record.columnKey ?? undefined,
    currentValue: record.currentValue,
    proposedValue: record.proposedValue,
    confidence: record.confidence,
    rationale: record.rationale,
    source: record.source,
    groupKey: record.groupKey,
  }));
}

export async function loadIssues(datasetId: string): Promise<Issue[]> {
  const db = getDb();
  const records = await db
    .select()
    .from(schema.issues)
    .where(eq(schema.issues.datasetId, datasetId));

  return records.map((record) => ({
    id: record.id,
    datasetId: record.datasetId,
    type: record.type,
    severity: record.severity,
    columnKey: record.columnKey ?? undefined,
    rowIds: record.rowIds,
    detectedBy: record.detectedBy,
    evidence: record.evidence,
  }));
}

/** Ambiguous issues that still have no suggestion — the LLM's work queue. */
export async function loadAmbiguousIssues(
  datasetId: string,
  options: { offset: number; limit: number },
) {
  const db = getDb();
  return db
    .select()
    .from(schema.issues)
    .where(
      and(
        eq(schema.issues.datasetId, datasetId),
        eq(schema.issues.ambiguous, true),
      ),
    )
    .orderBy(schema.issues.id)
    .limit(options.limit)
    .offset(options.offset);
}

export async function countAmbiguousIssues(datasetId: string): Promise<number> {
  const db = getDb();
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.issues)
    .where(
      and(
        eq(schema.issues.datasetId, datasetId),
        eq(schema.issues.ambiguous, true),
      ),
    );
  return result?.count ?? 0;
}

export async function loadRowsByIds(ids: string[]): Promise<DataRow[]> {
  if (ids.length === 0) return [];
  const db = getDb();
  const records = await db
    .select({
      id: schema.rows.id,
      rowIndex: schema.rows.rowIndex,
      data: schema.rows.data,
    })
    .from(schema.rows)
    .where(inArray(schema.rows.id, ids));
  return records;
}

export async function getDataset(datasetId: string) {
  const db = getDb();
  const [dataset] = await db
    .select()
    .from(schema.datasets)
    .where(eq(schema.datasets.id, datasetId));
  return dataset;
}

export async function buildSummary(
  datasetId: string,
): Promise<DatasetSummary | null> {
  const db = getDb();
  const dataset = await getDataset(datasetId);
  if (!dataset) return null;

  const counts = await db
    .select({
      type: schema.issues.type,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.issues)
    .where(eq(schema.issues.datasetId, datasetId))
    .groupBy(schema.issues.type);

  const issueCounts = Object.fromEntries(
    ISSUE_TYPES.map((type) => [type, 0]),
  ) as Record<IssueType, number>;
  for (const row of counts) issueCounts[row.type] = row.count;

  const cellCount = dataset.rowCount * Math.max(dataset.columns.length, 1);
  const missing = dataset.columns.reduce(
    (total, column) => total + column.nullCount,
    0,
  );

  return {
    id: dataset.id,
    filename: dataset.filename,
    rowCount: dataset.rowCount,
    columns: dataset.columns,
    issueCounts,
    completeness:
      cellCount === 0 ? 1 : Number(((cellCount - missing) / cellCount).toFixed(4)),
    status: dataset.status,
    progress: dataset.progress,
  };
}

export type DatasetListEntry = {
  id: string;
  filename: string;
  rowCount: number;
  status: DatasetStatus;
  createdAt: Date;
  /** Total suggestions raised, and how many still have no human decision. */
  suggestionCount: number;
  pendingCount: number;
};

/**
 * The upload history. Counts are aggregated in two grouped queries rather than
 * one per dataset — the list is the one place tempted into a query per row.
 *
 * Not scoped to a viewer, because the app has no concept of one: every upload on
 * a deployment is visible to everyone who opens it.
 */
export async function listDatasets(limit = 25): Promise<DatasetListEntry[]> {
  const db = getDb();

  const datasets = await db
    .select({
      id: schema.datasets.id,
      filename: schema.datasets.filename,
      rowCount: schema.datasets.rowCount,
      status: schema.datasets.status,
      createdAt: schema.datasets.createdAt,
    })
    .from(schema.datasets)
    .orderBy(desc(schema.datasets.createdAt))
    .limit(limit);

  if (datasets.length === 0) return [];

  const ids = datasets.map((dataset) => dataset.id);
  const counts = await db
    .select({
      datasetId: schema.suggestions.datasetId,
      total: sql<number>`count(*)::int`,
      pending: sql<number>`count(*) filter (where ${schema.suggestions.status} = 'pending')::int`,
    })
    .from(schema.suggestions)
    .where(inArray(schema.suggestions.datasetId, ids))
    .groupBy(schema.suggestions.datasetId);

  const byDataset = new Map(counts.map((row) => [row.datasetId, row]));

  return datasets.map((dataset) => ({
    ...dataset,
    suggestionCount: byDataset.get(dataset.id)?.total ?? 0,
    pendingCount: byDataset.get(dataset.id)?.pending ?? 0,
  }));
}

export type TraceEntry = {
  issueId: string;
  type: IssueType;
  severity: string;
  columnKey: string | null;
  evidence: string;
  detectedBy: string;
  /** True while the issue is still queued for the model. */
  ambiguous: boolean;
  rowIndexes: number[];
  suggestion: {
    id: string;
    action: string;
    source: string;
    confidence: number;
    rationale: string;
    currentValue: string | null;
    proposedValue: string | null;
    status: string;
    finalValue: string | null;
  } | null;
  decision: {
    reviewStatus: string;
    beforeState: Record<string, string> | null;
    afterState: Record<string, string> | null;
    decidedAt: Date;
  } | null;
};

/**
 * Every finding with whatever happened to it afterwards — the proposal it
 * produced, and the decision a human took. One row per issue, so a finding that
 * never reached a card is as visible as one that was applied.
 */
export async function loadTrace(datasetId: string): Promise<TraceEntry[]> {
  const db = getDb();

  const [issueRecords, suggestionRecords, auditRecords, rowRecords] =
    await Promise.all([
      db.select().from(schema.issues).where(eq(schema.issues.datasetId, datasetId)),
      db
        .select()
        .from(schema.suggestions)
        .where(eq(schema.suggestions.datasetId, datasetId)),
      db.select().from(schema.audit).where(eq(schema.audit.datasetId, datasetId)),
      db
        .select({ id: schema.rows.id, rowIndex: schema.rows.rowIndex })
        .from(schema.rows)
        .where(eq(schema.rows.datasetId, datasetId)),
    ]);

  const suggestionByIssue = new Map(
    suggestionRecords.map((record) => [record.issueId, record]),
  );
  const auditBySuggestion = new Map(
    auditRecords.map((record) => [record.suggestionId, record]),
  );
  const rowIndexById = new Map(
    rowRecords.map((record) => [record.id, record.rowIndex]),
  );

  return issueRecords
    .map((issue) => {
      const suggestion = suggestionByIssue.get(issue.id);
      const decision = suggestion ? auditBySuggestion.get(suggestion.id) : undefined;

      return {
        issueId: issue.id,
        type: issue.type,
        severity: issue.severity,
        columnKey: issue.columnKey,
        evidence: issue.evidence,
        detectedBy: issue.detectedBy,
        ambiguous: issue.ambiguous,
        rowIndexes: issue.rowIds
          .map((rowId) => rowIndexById.get(rowId))
          .filter((index): index is number => index !== undefined)
          .map((index) => index + 1),
        suggestion: suggestion
          ? {
              id: suggestion.id,
              action: suggestion.action,
              source: suggestion.source,
              confidence: suggestion.confidence,
              rationale: suggestion.rationale,
              currentValue: suggestion.currentValue,
              proposedValue: suggestion.proposedValue,
              status: suggestion.status,
              finalValue: suggestion.finalValue,
            }
          : null,
        decision: decision
          ? {
              reviewStatus: decision.reviewStatus,
              beforeState: decision.beforeState,
              afterState: decision.afterState,
              decidedAt: decision.decidedAt,
            }
          : null,
      };
    })
    .sort(
      (a, b) =>
        a.type.localeCompare(b.type) ||
        (a.columnKey ?? "").localeCompare(b.columnKey ?? "") ||
        (a.rowIndexes[0] ?? 0) - (b.rowIndexes[0] ?? 0),
    );
}

/** What the model cost on this dataset, one row per batch. */
export async function loadUsage(datasetId: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.llmUsage)
    .where(eq(schema.llmUsage.datasetId, datasetId))
    .orderBy(schema.llmUsage.createdAt);
}

/** Share of suggestions the rules engine produced. The headline demo metric. */
export async function ruleShare(datasetId: string): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({
      source: schema.suggestions.source,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.suggestions)
    .where(eq(schema.suggestions.datasetId, datasetId))
    .groupBy(schema.suggestions.source);

  const total = rows.reduce((sum, row) => sum + row.count, 0);
  if (total === 0) return 1;
  const byRule = rows.find((row) => row.source === "rule")?.count ?? 0;
  return byRule / total;
}

export async function recordUsage(
  datasetId: string,
  provider: string,
  model: string,
  usage: { inputTokens: number; outputTokens: number; cachedTokens: number },
): Promise<void> {
  if (usage.inputTokens === 0 && usage.outputTokens === 0) return;
  const db = getDb();
  await db.insert(schema.llmUsage).values({
    datasetId,
    provider,
    model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedTokens: usage.cachedTokens,
  });
}

/** Recomputes per-column null counts once every row is stored. */
export function countNulls(rows: DataRow[], key: string): number {
  return rows.filter((row) => isMissing(row.data[key])).length;
}
