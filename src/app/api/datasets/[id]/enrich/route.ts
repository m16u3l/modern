import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { groupKeyFor } from "@/lib/contracts";
import {
  BATCH_SIZE,
  UNANSWERED_CONFIDENCE,
  getLlm,
  renderColumnContext,
  reviewWithFallback,
  unansweredCandidates,
  type CandidateIssue,
} from "@/lib/llm";
import {
  countAmbiguousIssues,
  getDataset,
  loadAmbiguousIssues,
  loadRowsByIds,
  recordUsage,
} from "@/lib/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * One batch of ambiguous issues per invocation. Only what the rules engine
 * could not resolve reaches a model, and only the profile of the relevant
 * columns plus the affected rows are sent — never the whole dataset.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = getDb();

  const dataset = await getDataset(id);
  if (!dataset) return Response.json({ error: "Unknown dataset" }, { status: 404 });

  const pending = await loadAmbiguousIssues(id, { offset: 0, limit: BATCH_SIZE });

  if (pending.length === 0) {
    await db
      .update(schema.datasets)
      .set({ status: "ready", progress: 1 })
      .where(eq(schema.datasets.id, id));
    return Response.json({ done: true, progress: 1, remaining: 0 });
  }

  const rowIds = [...new Set(pending.flatMap((issue) => issue.rowIds))];
  const rows = await loadRowsByIds(rowIds);
  const rowsById = new Map(rows.map((row) => [row.id, row]));

  const candidates: CandidateIssue[] = pending.map((issue) => {
    const involved = issue.rowIds
      .map((rowId) => rowsById.get(rowId))
      .filter((row): row is NonNullable<typeof row> => row !== undefined);

    const primary = involved[0];
    return {
      id: issue.id,
      type: issue.type,
      columnKey: issue.columnKey ?? undefined,
      evidence: issue.evidence,
      rows: involved,
      currentValue:
        issue.columnKey && primary ? (primary.data[issue.columnKey] ?? null) : null,
    };
  });

  const llm = getLlm();

  try {
    const {
      review: { verdicts, usage },
      provider,
      degradedFrom,
    } = await reviewWithFallback(llm, {
      columnContext: renderColumnContext(dataset.columns, dataset.rowCount),
      candidates: candidates.filter((candidate) => candidate.rows.length > 0),
    });

    const byIssue = new Map(pending.map((issue) => [issue.id, issue]));

    const suggestions = verdicts.flatMap((verdict) => {
      const issue = byIssue.get(verdict.candidateId);
      if (!issue) return [];
      const row = rowsById.get(verdict.rowId);

      return [
        {
          issueId: issue.id,
          datasetId: id,
          action: verdict.action,
          rowId: verdict.rowId,
          columnKey: issue.columnKey,
          currentValue:
            issue.columnKey && row ? (row.data[issue.columnKey] ?? null) : null,
          proposedValue: verdict.proposedValue,
          confidence: verdict.confidence,
          rationale: verdict.rationale,
          source: "llm" as const,
          groupKey: groupKeyFor(issue.type, issue.columnKey ?? undefined),
        },
      ];
    });

    // A model answers what it wants to. Anything it left out still gets a card,
    // flagged for a human — a detected problem must never disappear just because
    // the model declined to have an opinion about it.
    const declined = unansweredCandidates(
      candidates.filter((candidate) => candidate.rows.length > 0),
      verdicts,
    ).flatMap((candidate) => {
      const issue = byIssue.get(candidate.id);
      if (!issue) return [];

      return [
        {
          issueId: issue.id,
          datasetId: id,
          action: "no_action" as const,
          rowId: candidate.rows[0].id,
          columnKey: issue.columnKey,
          currentValue: candidate.currentValue,
          proposedValue: null,
          confidence: UNANSWERED_CONFIDENCE,
          rationale: `${issue.evidence} The model returned no verdict for this one, so it needs a human.`,
          source: "llm" as const,
          groupKey: groupKeyFor(issue.type, issue.columnKey ?? undefined),
        },
      ];
    });

    await db.transaction(async (tx) => {
      if (suggestions.length + declined.length > 0) {
        await tx.insert(schema.suggestions).values([...suggestions, ...declined]);
      }
      // Cleared whether or not a verdict came back, so a model that skips a
      // candidate cannot put this loop into an infinite cycle.
      await tx
        .update(schema.issues)
        .set({ ambiguous: false })
        .where(
          inArray(
            schema.issues.id,
            pending.map((issue) => issue.id),
          ),
        );
    });

    // Recorded against whoever actually answered, never the provider that was
    // asked. A degraded batch spends no tokens, so `recordUsage` writes nothing
    // and the cost report stays honest by omission.
    await recordUsage(id, provider.id, provider.model, usage);

    const remaining = await countAmbiguousIssues(id);
    const processed = dataset.enrichCursor + pending.length;

    await db
      .update(schema.datasets)
      .set({
        enrichCursor: processed,
        status: remaining === 0 ? "ready" : "enriching",
      })
      .where(eq(schema.datasets.id, id));

    return Response.json({
      done: remaining === 0,
      remaining,
      processed,
      suggestionsAdded: suggestions.length + declined.length,
      unanswered: declined.length,
      provider: provider.id,
      model: provider.model,
      degradedFrom,
      progress: processed / (processed + remaining),
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "The model call failed",
        provider: llm.id,
      },
      { status: 502 },
    );
  }
}
