import { z } from "zod";
import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { reviewStatusSchema } from "@/lib/contracts";
import { planChanges, summarise } from "@/lib/apply";
import { loadSuggestions } from "@/lib/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  decisions: z
    .array(
      z.object({
        suggestionId: z.string(),
        status: reviewStatusSchema,
        finalValue: z.string().nullable().optional(),
      }),
    )
    .max(20_000),
});

/**
 * Writes the accepted decisions onto the rows and records every one of them in
 * the audit log — including the rejections, because knowing what a reviewer
 * turned down is half the value of an audit trail.
 *
 * All of it happens in one transaction: a partially applied review would leave
 * the export and the audit log disagreeing, which is the one thing this tool
 * cannot afford. That guarantee is why this runs on Postgres.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: "Malformed decisions", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const db = getDb();
  const suggestions = await loadSuggestions(id);
  if (suggestions.length === 0) {
    return Response.json({ error: "Unknown dataset" }, { status: 404 });
  }

  const rowIds = [...new Set(suggestions.map((s) => s.rowId))];
  const rowRecords = await db
    .select({ id: schema.rows.id, data: schema.rows.data })
    .from(schema.rows)
    .where(inArray(schema.rows.id, rowIds));

  const rows = new Map(rowRecords.map((row) => [row.id, row.data]));

  const planned = planChanges(
    parsed.data.decisions.map((decision) => ({
      suggestionId: decision.suggestionId,
      status: decision.status,
      finalValue: decision.finalValue ?? null,
    })),
    suggestions,
    rows,
  );

  // Collapse per-row cell edits so a row with three accepted fixes is written
  // once rather than three times.
  const updates = new Map<string, Record<string, string>>();
  const deletions = new Set<string>();

  for (const entry of planned) {
    if (!entry.change) continue;
    if (entry.change.kind === "delete") {
      deletions.add(entry.change.rowId);
      continue;
    }
    const next = updates.get(entry.change.rowId) ?? {
      ...rows.get(entry.change.rowId)!,
    };
    next[entry.change.columnKey] = entry.change.after;
    updates.set(entry.change.rowId, next);
  }

  await db.transaction(async (tx) => {
    for (const [rowId, data] of updates) {
      if (deletions.has(rowId)) continue;
      await tx
        .update(schema.rows)
        .set({ data, dirty: true })
        .where(eq(schema.rows.id, rowId));
    }

    if (deletions.size > 0) {
      await tx
        .update(schema.rows)
        .set({ deleted: true, dirty: true })
        .where(inArray(schema.rows.id, [...deletions]));
    }

    for (const entry of planned) {
      await tx
        .update(schema.suggestions)
        .set({ status: entry.status, finalValue: entry.finalValue })
        .where(eq(schema.suggestions.id, entry.suggestion.id));
    }

    const auditEntries = planned.map((entry) => ({
      datasetId: id,
      suggestionId: entry.suggestion.id,
      rowId: entry.suggestion.rowId,
      columnKey: entry.suggestion.columnKey ?? null,
      action: entry.suggestion.action,
      beforeState: auditBefore(entry, rows),
      afterState: auditAfter(entry),
      source: entry.suggestion.source,
      reviewStatus: entry.status,
    }));

    if (auditEntries.length > 0) {
      await tx.insert(schema.audit).values(auditEntries);
    }

    await tx
      .update(schema.datasets)
      .set({ status: "ready" })
      .where(eq(schema.datasets.id, id));
  });

  return Response.json(summarise(planned));
}

type Planned = ReturnType<typeof planChanges>[number];

function auditBefore(
  entry: Planned,
  rows: Map<string, Record<string, string>>,
): Record<string, string> | null {
  if (!entry.change) return null;
  if (entry.change.kind === "delete") return rows.get(entry.change.rowId) ?? null;
  return { [entry.change.columnKey]: entry.change.before };
}

function auditAfter(entry: Planned): Record<string, string> | null {
  if (!entry.change) return null;
  if (entry.change.kind === "delete") return null;
  return { [entry.change.columnKey]: entry.change.after };
}
