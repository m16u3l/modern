import { issueSignedToken, presignUrl } from "@vercel/blob";

/**
 * The upload store is private: a CSV of somebody's customers has no business
 * sitting behind a guessable public URL. Reading one back therefore needs a
 * short-lived presigned URL rather than a plain fetch.
 */
export async function openBlob(blobUrl: string): Promise<Response> {
  const pathname = new URL(blobUrl).pathname.replace(/^\//, "");
  const validUntil = Date.now() + 10 * 60 * 1000;

  const signedToken = await issueSignedToken({
    token: process.env.BLOB_READ_WRITE_TOKEN,
    pathname,
    operations: ["get"],
    validUntil,
  });

  const { presignedUrl } = await presignUrl(signedToken, {
    operation: "get",
    pathname,
    access: "private",
    validUntil,
  });

  const response = await fetch(presignedUrl);

  if (!response.ok || !response.body) {
    throw new Error(
      `Could not read ${pathname} from blob storage (${response.status})`,
    );
  }

  return response;
}
