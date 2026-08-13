import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import {
  groupKeyFor,
  type DataRow,
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
