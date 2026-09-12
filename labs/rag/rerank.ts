import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Retriever } from "./retrieve";
import type { Hit } from "./store";

const OLLAMA = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const CACHE_DIR = path.join(import.meta.dirname, ".cache");

export const RERANK_MODEL = process.env.RERANK_MODEL ?? "qwen2.5:7b";

export type Reranker = (query: string, hits: Hit[], k: number) => Promise<Hit[]>;

/**
 * Pointwise reranking with a local generative model: every candidate is scored
 * against the question on its own, then the list is re-sorted.
 *
 * A real reranker is a cross-encoder — a model trained to read (query, passage)
 * as one sequence and emit a relevance score. None runs locally here, so this
 * substitutes a general instruction model asked for a number. That is a
 * different mechanism with a different failure mode and it is not evidence
 * about cross-encoders; it is evidence about what a 7B generalist does when
 * asked to judge relevance.
 */
export function llmReranker(model = RERANK_MODEL, concurrency = 4): Reranker {
  return async (query, hits, k) => {
    const scores = new Array<number>(hits.length);

    // Ollama serves one request at a time per model; a little concurrency hides
    // the round trip without queueing a hundred prompts behind each other.
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(concurrency, hits.length) }, async () => {
        while (next < hits.length) {
          const index = next++;
          scores[index] = await scoreOne(model, query, hits[index].chunk.text);
        }
      }),
    );

    return rankByScore(hits, scores, k);
  };
}

/**
 * Re-sort by the reranker's scores, keeping the retriever's order as the
 * tie-break. Ties are the common case, not an edge case: a 0-10 integer over
 * ten candidates collides constantly, and without a stable tie-break the
 * reranker silently shuffles everything it has no opinion about — which reads
 * as the reranker working.
 */
export function rankByScore(hits: Hit[], scores: number[], k: number): Hit[] {
  return hits
    .map((hit, index) => ({ hit, index, score: scores[index] ?? 0 }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, k)
    .map(({ hit, score }) => ({ ...hit, score }));
}

/**
 * Retrieve `depth` candidates, then let the reranker pick k of them. The depth
 * is the whole bet: a reranker can only reorder what retrieval already found,
 * so it cannot fix a miss, only a bad rank. Recall@k can still rise — because
 * the window it re-sorts is wider than the window being scored.
 */
export function withRerank(
  retrieve: Retriever,
  rerank: Reranker,
  depth: number,
): Retriever {
  return async (query, k) => rerank(query, await retrieve(query, depth), k);
}

const PROMPT = `You are scoring how well a passage answers a question.

Question: {question}

Passage:
{passage}

Reply with one integer from 0 to 10 and nothing else. 10 means the passage
directly answers the question; 0 means it is unrelated.`;

async function scoreOne(model: string, query: string, passage: string): Promise<number> {
  const cached = readCache(model, query, passage);
  if (cached !== undefined) return cached;

  const response = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        {
          role: "user",
          content: PROMPT.replace("{question}", query).replace("{passage}", passage),
        },
      ],
      options: { temperature: 0, num_predict: 8 },
    }),
  });

  if (!response.ok) {
    throw new Error(`rerank failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as { message: { content: string } };
  const score = parseScore(body.message.content);

  writeCache(model, query, passage, score);
  return score;
}

/**
 * A model told to answer with one integer does not always answer with one
 * integer. An unparseable reply scores 0 rather than throwing: the run should
 * report a worse reranker, not stop.
 */
export function parseScore(reply: string): number {
  const match = reply.match(/\d+/);
  if (!match) return 0;
  return Math.max(0, Math.min(10, Number(match[0])));
}

function cachePath(model: string, query: string, passage: string): string {
  const key = createHash("sha256")
    .update(`${model}::${query}::${passage}`)
    .digest("hex");
  return path.join(CACHE_DIR, `rerank-${key}.json`);
}

function readCache(model: string, query: string, passage: string): number | undefined {
  const file = cachePath(model, query, passage);
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, "utf8")) as number;
}

function writeCache(model: string, query: string, passage: string, score: number): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cachePath(model, query, passage), JSON.stringify(score));
}
