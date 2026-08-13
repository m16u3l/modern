import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { openBlob } from "@/lib/blob";
import { parseCsv } from "@/lib/csv";
import { getDataset } from "@/lib/persistence";
import { MAX_DEMO_ROWS } from "@/lib/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Route handlers do not inherit maxDuration from a layout, so it is declared here.
export const maxDuration = 60;

const INSERT_BATCH = 500;

/**
 * Streams the uploaded CSV out of blob storage and materialises its rows. At the
 * demo's row cap this fits one invocation comfortably; the expensive part —
 * profiling — is what gets chunked.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = getDb();

  const dataset = await getDataset(id);
  if (!dataset) return Response.json({ error: "Unknown dataset" }, { status: 404 });
  if (!dataset.blobUrl) {
    return Response.json({ error: "Dataset has no uploaded file" }, { status: 409 });
  }

  try {
    const response = await openBlob(dataset.blobUrl);
    const { headers, rows, truncated, totalSeen } = parseCsv(
      await response.text(),
    );

    if (headers.length === 0 || rows.length === 0) {
      return Response.json(
        { error: "That file has no readable rows" },
        { status: 422 },
      );
    }

    // Re-parsing must not double the rows if the client retries.
    await db.delete(schema.rows).where(eq(schema.rows.datasetId, id));

    for (let offset = 0; offset < rows.length; offset += INSERT_BATCH) {
      await db.insert(schema.rows).values(
        rows.slice(offset, offset + INSERT_BATCH).map((data, index) => ({
          datasetId: id,
          rowIndex: offset + index,
          data,
        })),
      );
    }

    await db
      .update(schema.datasets)
      .set({
        rowCount: rows.length,
        headers,
        status: "profiling",
        progress: 0,
        profileCursor: 0,
        enrichCursor: 0,
        columns: [],
      })
      .where(eq(schema.datasets.id, id));

    return Response.json({
      rowCount: rows.length,
      headers,
      truncated,
      totalSeen,
      cap: MAX_DEMO_ROWS,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not parse the file" },
      { status: 500 },
    );
  }
}
