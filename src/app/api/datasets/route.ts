import { z } from "zod";
import { desc } from "drizzle-orm";
import { getDb, schema } from "@/db";

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
  const datasets = await getDb()
    .select({
      id: schema.datasets.id,
      filename: schema.datasets.filename,
      rowCount: schema.datasets.rowCount,
      status: schema.datasets.status,
      createdAt: schema.datasets.createdAt,
    })
    .from(schema.datasets)
    .orderBy(desc(schema.datasets.createdAt))
    .limit(25);

  return Response.json({ datasets });
}
