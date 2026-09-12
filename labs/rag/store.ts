import type { Chunk } from "./chunk";

export type Hit = { chunk: Chunk; score: number };

/**
 * Cosine similarity over normalised vectors, which makes it a dot product.
 * A flat array scan: the corpus is a few hundred chunks, and an index that
 * beats a linear scan at this size would be a lie about what pgvector buys.
 */
export class VectorIndex {
  private readonly vectors: number[][] = [];
  private readonly chunks: Chunk[] = [];

  add(chunk: Chunk, vector: number[]): void {
    this.chunks.push(chunk);
    this.vectors.push(normalise(vector));
  }

  search(queryVector: number[], k: number): Hit[] {
    const query = normalise(queryVector);

    return this.vectors
      .map((vector, i) => ({ chunk: this.chunks[i], score: dot(vector, query) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}

/**
 * BM25, written out rather than imported, because the point of the hybrid
 * comparison is knowing what the lexical half actually does: term frequency
 * saturating at `k1`, length normalisation at `b`, and an idf that goes
 * negative for terms appearing in more than half the corpus.
 */
export class Bm25Index {
  private readonly chunks: Chunk[] = [];
  private readonly termFreqs: Map<string, number>[] = [];
  private readonly lengths: number[] = [];
  private readonly docFreq = new Map<string, number>();

  constructor(
    private readonly k1 = 1.2,
    private readonly b = 0.75,
  ) {}

  add(chunk: Chunk): void {
    const terms = tokenise(chunk.text);
    const freqs = new Map<string, number>();

    for (const term of terms) freqs.set(term, (freqs.get(term) ?? 0) + 1);
    for (const term of freqs.keys()) {
      this.docFreq.set(term, (this.docFreq.get(term) ?? 0) + 1);
    }

    this.chunks.push(chunk);
    this.termFreqs.push(freqs);
    this.lengths.push(terms.length);
  }

  search(query: string, k: number): Hit[] {
    const n = this.chunks.length;
    const avgLength = this.lengths.reduce((a, b) => a + b, 0) / n;
    const terms = tokenise(query);

    return this.chunks
      .map((chunk, i) => {
        let score = 0;

        for (const term of terms) {
          const freq = this.termFreqs[i].get(term);
          if (!freq) continue;

          const df = this.docFreq.get(term) ?? 0;
          const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
          const norm = 1 - this.b + (this.b * this.lengths[i]) / avgLength;

          score += idf * ((freq * (this.k1 + 1)) / (freq + this.k1 * norm));
        }

        return { chunk, score };
      })
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}

/** Lowercase, strip punctuation, drop one-character tokens. No stemming. */
export function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((token) => token.length > 1);
}

function normalise(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));
  return magnitude === 0 ? vector : vector.map((x) => x / magnitude);
}

function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}
