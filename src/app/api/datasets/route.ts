import { z } from "zod";
import { getDb, schema } from "@/db";
import { listDatasets } from "@/lib/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  filename: z.string().min(1).max(255),
  blobUrl: z.string().url(),
});

/**
 * Registers a dataset once the browser has finished uploading to blob storage.
 * Called explicitly by the client rather than from the blob webhook, so the
 * flow behaves identically on localhost and in production.
 */
export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: "Expected a filename and a blobUrl", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const [dataset] = await getDb()
    .insert(schema.datasets)
    .values({
      filename: parsed.data.filename,
      blobUrl: parsed.data.blobUrl,
      status: "uploaded",
    })
    .returning({ id: schema.datasets.id });

  return Response.json({ id: dataset.id }, { status: 201 });
}

export async function GET() {
  return Response.json({ datasets: await listDatasets() });
}
