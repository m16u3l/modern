import { put } from "@vercel/blob";
import { getDb, schema } from "@/db";
import { toCsv } from "@/lib/csv";
import { FIXTURE_ROWS } from "@/lib/fixtures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Seeds a dataset from the bundled messy CSV. It goes through blob storage and
 * the same parse → profile → enrich pipeline as a real upload, so the demo
 * exercises the actual code path rather than a shortcut around it.
 */
export async function POST() {
  const headers = Object.keys(FIXTURE_ROWS[0].data);
  const csv = toCsv(
    headers,
    FIXTURE_ROWS.map((row) => row.data),
  );

  const blob = await put("demo/messy-customers.csv", csv, {
    access: "private",
    contentType: "text/csv",
    addRandomSuffix: true,
  });

  const [dataset] = await getDb()
    .insert(schema.datasets)
    .values({
      filename: "messy-customers.csv",
      blobUrl: blob.url,
      status: "uploaded",
    })
    .returning({ id: schema.datasets.id });

  return Response.json({ id: dataset.id }, { status: 201 });
}
