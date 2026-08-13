import Papa from "papaparse";
import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getDataset } from "@/lib/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGE_SIZE = 500;

/**
 * Streams the result out in pages rather than building the whole file in
 * memory: the cleaned export is the one response whose size grows with the
 * dataset, so it is the one that must not.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const format = new URL(request.url).searchParams.get("format") ?? "csv";

  const dataset = await getDataset(id);
  if (!dataset) return Response.json({ error: "Unknown dataset" }, { status: 404 });

  const slug = dataset.filename.replace(/\.csv$/i, "") || "dataset";

  if (format === "audit") {
    return streamAudit(id, slug);
  }
  if (format !== "csv") {
    return Response.json(
      { error: 'format must be "csv" or "audit"' },
      { status: 400 },
    );
  }

  const headers = dataset.columns.map((column) => column.key);
  if (headers.length === 0) {
    return Response.json({ error: "Dataset has not been profiled" }, { status: 409 });
  }

  const db = getDb();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(
          encoder.encode(Papa.unparse([headers], { newline: "\n" }) + "\n"),
        );

        for (let offset = 0; ; offset += PAGE_SIZE) {
          const page = await db
            .select({ data: schema.rows.data })
            .from(schema.rows)
            .where(
              and(
                eq(schema.rows.datasetId, id),
                // Rows a reviewer accepted for deletion are simply absent.
                eq(schema.rows.deleted, false),
              ),
            )
            .orderBy(asc(schema.rows.rowIndex))
            .limit(PAGE_SIZE)
            .offset(offset);

          if (page.length === 0) break;

          controller.enqueue(
            encoder.encode(
              Papa.unparse(
                page.map((row) => headers.map((key) => row.data[key] ?? "")),
                { newline: "\n" },
              ) + "\n",
            ),
          );

          if (page.length < PAGE_SIZE) break;
        }

        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-cleaned.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

/**
 * The audit export is what makes this usable somewhere real: every decision,
 * what it changed, who proposed it and whether a human agreed.
 */
async function streamAudit(datasetId: string, slug: string): Promise<Response> {
  const db = getDb();

  const entries = await db
    .select()
    .from(schema.audit)
    .where(eq(schema.audit.datasetId, datasetId))
    .orderBy(asc(schema.audit.decidedAt));

  const usage = await db
    .select()
    .from(schema.llmUsage)
    .where(eq(schema.llmUsage.datasetId, datasetId));

  const body = {
    datasetId,
    exportedAt: new Date().toISOString(),
    decisionCount: entries.length,
    decisions: entries.map((entry) => ({
      suggestionId: entry.suggestionId,
      rowId: entry.rowId,
      columnKey: entry.columnKey,
      action: entry.action,
      reviewStatus: entry.reviewStatus,
      proposedBy: entry.source,
      before: entry.beforeState,
      after: entry.afterState,
      decidedAt: entry.decidedAt,
    })),
    llmUsage: usage.map((record) => ({
      provider: record.provider,
      model: record.model,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      cachedTokens: record.cachedTokens,
    })),
  };

  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-audit.json"`,
      "Cache-Control": "no-store",
    },
  });
}
