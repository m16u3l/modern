import type { Chunk } from "./chunk";
import { embedAll } from "./embed";
import { Bm25Index, VectorIndex, type Hit } from "./store";

export type Retriever = (query: string, k: number) => Promise<Hit[]>;

/**
 * Some embedding models are trained with an instruction prefix and expect a
 * different one on each side — the document and the question are not the same
 * kind of text, and the model was told which was which during training.
 * Whether it matters here is measured rather than assumed: `run.ts` scores the
 * same model with and without.
 */
export type Prefixes = { doc: string; query: string };

export const NO_PREFIX: Prefixes = { doc: "", query: "" };
export const NOMIC_PREFIX: Prefixes = {
  doc: "search_document: ",
  query: "search_query: ",
};

/** Everything the three strategies need, built once per (corpus, model). */
export type Indexes = {
  vector: VectorIndex;
  lexical: Bm25Index;
  model: string;
  prefixes: Prefixes;
};

export async function buildIndexes(
  chunks: Chunk[],
  model: string,
  prefixes: Prefixes = NO_PREFIX,
): Promise<Indexes> {
  const vectors = await embedAll(
    model,
    chunks.map((chunk) => `${prefixes.doc}${chunk.text}`),
  );

  const vector = new VectorIndex();
  const lexical = new Bm25Index();

  chunks.forEach((chunk, i) => {
    vector.add(chunk, vectors[i]);
    lexical.add(chunk);
  });

  return { vector, lexical, model, prefixes };
}

export function vectorRetriever(indexes: Indexes): Retriever {
  return async (query, k) => {
    const [embedded] = await embedAll(indexes.model, [`${indexes.prefixes.query}${query}`]);
    return indexes.vector.search(embedded, k);
  };
}

export function lexicalRetriever(indexes: Indexes): Retriever {
  return async (query, k) => indexes.lexical.search(query, k);
}

/**
 * Hybrid by Reciprocal Rank Fusion: each list votes with 1/(rank + K), and the
 * votes are summed. Fusing on rank rather than score is what makes it work at
 * all here — a BM25 score of 14.2 and a cosine of 0.61 are not on any common
 * scale, and normalising them per query invents one.
 */
export function hybridRetriever(indexes: Indexes, rrfK = 60): Retriever {
  const vector = vectorRetriever(indexes);
  const lexical = lexicalRetriever(indexes);

  return async (query, k) => {
    // Fuse deeper lists than requested: a chunk ranked 8th by both retrievers
    // should be able to win, and it cannot if neither list is read past k.
    const depth = Math.max(k * 3, 20);
    const [dense, sparse] = await Promise.all([
      vector(query, depth),
      lexical(query, depth),
    ]);

    const fused = new Map<string, { chunk: Chunk; score: number }>();

    for (const list of [dense, sparse]) {
      list.forEach((hit, rank) => {
        const entry = fused.get(hit.chunk.id) ?? { chunk: hit.chunk, score: 0 };
        entry.score += 1 / (rank + 1 + rrfK);
        fused.set(hit.chunk.id, entry);
      });
    }

    return [...fused.values()].sort((a, b) => b.score - a.score).slice(0, k);
  };
}
