import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { MAX_DEMO_ROWS } from "@/lib/contracts";

export const runtime = "nodejs";

/**
 * Issues a short-lived client token so the browser uploads straight to blob
 * storage. The CSV never passes through a serverless function, which is what
 * gets us past the 4.5 MB request body ceiling.
 */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: [
          "text/csv",
          "application/csv",
          "text/plain",
          "application/vnd.ms-excel",
        ],
        // Generous next to the row cap: the cap is what actually bounds the work.
        maximumSizeInBytes: 50 * 1024 * 1024,
        addRandomSuffix: true,
      }),
      onUploadCompleted: async () => {
        // The dataset row is created by an explicit call from the client, so
        // that the flow also works on localhost where this webhook never fires.
      },
    });

    return Response.json(result);
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Upload failed",
        hint: `Datasets are capped at ${MAX_DEMO_ROWS.toLocaleString()} rows in this demo.`,
      },
      { status: 400 },
    );
  }
}
