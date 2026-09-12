/**
 * The three metrics the week asks for, over a ranked list of headings against
 * the set of headings that actually answer the question.
 *
 * They disagree on purpose. Recall asks whether the answer is in the window at
 * all; MRR asks how far down it was; nDCG asks the same but keeps counting
 * after the first hit, which is the only one of the three that notices a second
 * relevant passage.
 */

export function recallAt(ranked: string[], relevant: Set<string>, k: number): number {
  const found = ranked.slice(0, k).filter((heading) => relevant.has(heading));
  return new Set(found).size / relevant.size;
}

/** Reciprocal rank of the first relevant hit; 0 when there is none. */
export function reciprocalRank(ranked: string[], relevant: Set<string>): number {
  const index = ranked.findIndex((heading) => relevant.has(heading));
  return index === -1 ? 0 : 1 / (index + 1);
}

export function ndcgAt(ranked: string[], relevant: Set<string>, k: number): number {
  const seen = new Set<string>();
  let dcg = 0;

  ranked.slice(0, k).forEach((heading, i) => {
    // A duplicate of a heading already counted is not a second answer. Without
    // this, a chunking strategy that cuts one section into four pieces scores
    // higher for having said the same thing four times.
    if (!relevant.has(heading) || seen.has(heading)) return;
    seen.add(heading);
    dcg += 1 / Math.log2(i + 2);
  });

  let ideal = 0;
  for (let i = 0; i < Math.min(relevant.size, k); i++) {
    ideal += 1 / Math.log2(i + 2);
  }

  return ideal === 0 ? 0 : dcg / ideal;
}
