import { describe, expect, it } from "vitest";
import { ndcgAt, recallAt, reciprocalRank } from "./metrics";
import { Bm25Index, VectorIndex, tokenise } from "./store";

const relevant = new Set(["A", "B"]);

describe("recallAt", () => {
  it("is the share of relevant sections inside the window", () => {
    expect(recallAt(["A", "x", "y"], relevant, 3)).toBe(0.5);
    expect(recallAt(["A", "B", "y"], relevant, 3)).toBe(1);
  });

  it("does not see past k", () => {
    expect(recallAt(["x", "y", "A"], relevant, 2)).toBe(0);
  });

  it("counts a repeated section once", () => {
    expect(recallAt(["A", "A", "A"], relevant, 3)).toBe(0.5);
  });
});

describe("reciprocalRank", () => {
  it("rewards the position of the first hit", () => {
    expect(reciprocalRank(["A"], relevant)).toBe(1);
    expect(reciprocalRank(["x", "A"], relevant)).toBe(0.5);
    expect(reciprocalRank(["x", "y"], relevant)).toBe(0);
  });
});

describe("ndcgAt", () => {
  it("is 1 when both relevant sections lead the list", () => {
    expect(ndcgAt(["A", "B", "x"], relevant, 3)).toBeCloseTo(1);
  });

  it("discounts a hit that arrives later", () => {
    expect(ndcgAt(["x", "A", "B"], relevant, 3)).toBeLessThan(1);
  });

  it("ignores a duplicate of a section already counted", () => {
    // Otherwise a chunking strategy that cuts one section into four scores
    // higher for having said the same thing four times.
    expect(ndcgAt(["A", "A", "A"], relevant, 3)).toBeCloseTo(
      ndcgAt(["A", "x", "y"], relevant, 3),
    );
  });
});

describe("store", () => {
  const chunk = (id: string, text: string) => ({
    id,
    docId: "d",
    headings: [id],
    text,
  });

  it("ranks by cosine, not by magnitude", () => {
    const index = new VectorIndex();
    index.add(chunk("near", "n"), [10, 0]);
    index.add(chunk("far", "f"), [0, 1]);

    const [top] = index.search([1, 0], 2);
    expect(top.chunk.id).toBe("near");
    expect(top.score).toBeCloseTo(1);
  });

  it("scores a rare term above a common one", () => {
    const index = new Bm25Index();
    index.add(chunk("rare", "quantisation is the topic here"));
    index.add(chunk("common", "the topic here is something else"));
    index.add(chunk("other", "the topic here is a third thing"));

    expect(index.search("quantisation", 3)[0].chunk.id).toBe("rare");
  });

  it("drops punctuation and single characters when tokenising", () => {
    expect(tokenise("Q8_0: twice the bits, a — no")).toEqual([
      "q8_0",
      "twice",
      "the",
      "bits",
      "no",
    ]);
  });
});
