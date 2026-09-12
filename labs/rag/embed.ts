import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const OLLAMA = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const CACHE_DIR = path.join(import.meta.dirname, ".cache");

export type EmbedModel = { label: string; name: string; dims: number };

/** Both are local. The comparison is the point: 384 dims against 768. */
export const EMBED_MODELS: EmbedModel[] = [
  { label: "nomic-embed-text", name: "nomic-embed-text", dims: 768 },
  { label: "all-minilm", name: "all-minilm", dims: 384 },
];

/**
 * Embeds with an on-disk cache keyed by (model, text). Re-embedding the corpus
 * on every run would make the eval slow enough to stop being run, and the
 * vectors are deterministic for a fixed model, so there is nothing to lose by
 * keeping them.
 */
export async function embedAll(
  model: string,
  texts: string[],
  batchSize = 16,
): Promise<number[][]> {
  mkdirSync(CACHE_DIR, { recursive: true });

  const out = new Array<number[] | undefined>(texts.length);
  const missing: number[] = [];

  texts.forEach((text, i) => {
    const cached = readCache(model, text);
    if (cached) out[i] = cached;
    else missing.push(i);
  });

  for (let i = 0; i < missing.length; i += batchSize) {
    const slice = missing.slice(i, i + batchSize);
    const vectors = await embedBatch(
      model,
      slice.map((index) => texts[index]),
    );

    slice.forEach((index, j) => {
      out[index] = vectors[j];
      writeCache(model, texts[index], vectors[j]);
    });
  }

  return out as number[][];
}

async function embedBatch(model: string, input: string[]): Promise<number[][]> {
  const response = await fetch(`${OLLAMA}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // `truncate` defaults to true: an input longer than the model's context
    // is silently cut and still returns a vector, which is week 2's silent
    // truncation wearing an embedding hat. Fail instead.
    body: JSON.stringify({ model, input, truncate: false }),
  });

  if (!response.ok) {
    throw new Error(
      `embed failed: ${response.status} ${await response.text()} - is ollama serving?`,
    );
  }

  const body = (await response.json()) as { embeddings: number[][] };
  return body.embeddings;
}

function cachePath(model: string, text: string): string {
  const key = createHash("sha256").update(`${model}::${text}`).digest("hex");
  return path.join(CACHE_DIR, `${key}.json`);
}

function readCache(model: string, text: string): number[] | undefined {
  const file = cachePath(model, text);
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, "utf8")) as number[];
}

function writeCache(model: string, text: string, vector: number[]): void {
  writeFileSync(cachePath(model, text), JSON.stringify(vector));
}
