import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import {
  computeColumnStats,
  detectCrossRow,
  detectRowLevel,
} from "@/lib/profiling";
import { getDataset, loadRows, persistFindings } from "@/lib/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const CHUNK_SIZE = 1000;

/**
 * One chunk of deterministic profiling per invocation. The client calls this in
 * a loop until `done`, which keeps every invocation far from the platform's
 * timeout no matter how large the file is.
 *
 * The final call also runs the cross-row detectors (duplicates), which need to
 * see every row at once.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = getDb();

  const dataset = await getDataset(id);
  if (!dataset) return Response.json({ error: "Unknown dataset" }, { status: 404 });
  // Both are set by parse. Without the headers every detector would run over an
  // empty column list and report a spotless dataset, which is worse than failing.
  if (dataset.rowCount === 0 || dataset.headers.length === 0) {
    return Response.json({ error: "Parse the file first" }, { status: 409 });
  }

  const cursor = dataset.profileCursor;

  if (cursor >= dataset.rowCount) {
    return Response.json({ progress: 1, done: true, processed: cursor });
  }

  // Column statistics are computed once, from the first chunk, and reused for
  // every later chunk. Recomputing them per chunk would let the same value be a
  // format minority in one chunk and the majority in the next.
  let columns = dataset.columns;
  if (cursor === 0 || columns.length === 0) {
    const sample = await loadRows(id, { offset: 0, limit: CHUNK_SIZE });
    columns = computeColumnStats(sample, dataset.headers);

    // nullCount from the sample would understate a large file; scale it later
    // during the final pass, where the whole dataset is already in memory.
    await db
      .update(schema.datasets)
      .set({ columns, status: "profiling" })
      .where(eq(schema.datasets.id, id));
  }

  const chunk = await loadRows(id, { offset: cursor, limit: CHUNK_SIZE });
  await persistFindings(id, detectRowLevel(chunk, columns));

  const nextCursor = cursor + chunk.length;
  const rowsDone = nextCursor >= dataset.rowCount;

  if (rowsDone) {
    // Cross-row pass. At the 5k cap this is one query and one in-memory scan;
    // past that it is the first thing that would move to a queued worker.
    const allRows = await loadRows(id);
    await persistFindings(id, detectCrossRow(allRows, dataset.headers));

    const exactColumns = computeColumnStats(allRows, dataset.headers);
    await db
      .update(schema.datasets)
      .set({
        columns: exactColumns,
        profileCursor: nextCursor,
        progress: 1,
        status: "enriching",
      })
      .where(eq(schema.datasets.id, id));
  } else {
    await db
      .update(schema.datasets)
      .set({
        profileCursor: nextCursor,
        progress: nextCursor / dataset.rowCount,
      })
      .where(eq(schema.datasets.id, id));
  }

  return Response.json({
    processed: nextCursor,
    total: dataset.rowCount,
    progress: rowsDone ? 1 : nextCursor / dataset.rowCount,
    done: rowsDone,
  });
}
