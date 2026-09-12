import { describe, expect, it } from "vitest";
import { parseScore, rankByScore, withRerank } from "./rerank";
import type { Hit } from "./store";

const hit = (id: string): Hit => ({
  chunk: { id, docId: "d", headings: [id], text: id },
  score: 0,
});

describe("parseScore", () => {
  it("reads the integer out of a reply that was told not to have anything else", () => {
    expect(parseScore("7")).toBe(7);
    expect(parseScore("Score: 7/10")).toBe(7);
    expect(parseScore(" 10 ")).toBe(10);
  });

  it("scores an unparseable reply 0 rather than throwing", () => {
    expect(parseScore("I cannot assess this passage.")).toBe(0);
  });

  it("clamps a model that ignores the range", () => {
    expect(parseScore("99")).toBe(10);
  });
});

describe("rankByScore", () => {
  it("promotes a later candidate the reranker preferred", () => {
    const ranked = rankByScore([hit("a"), hit("b"), hit("c")], [1, 9, 2], 3);
    expect(ranked.map((h) => h.chunk.id)).toEqual(["b", "c", "a"]);
  });

  it("keeps the retriever's order when scores tie", () => {
    const ranked = rankByScore([hit("a"), hit("b"), hit("c")], [2, 2, 2], 3);
    expect(ranked.map((h) => h.chunk.id)).toEqual(["a", "b", "c"]);
  });

  it("carries the reranker's score, not the retriever's", () => {
    expect(rankByScore([hit("a")], [4], 1)[0].score).toBe(4);
  });
});

describe("withRerank", () => {
  it("retrieves at depth and returns k", async () => {
    let askedFor = 0;
    const retrieve = async (_q: string, depth: number) => {
      askedFor = depth;
      return ["a", "b", "c", "d"].map(hit);
    };
    // Reverses, so the last candidate retrieved should end up first.
    const rerank = async (_q: string, hits: Hit[], k: number) =>
      [...hits].reverse().slice(0, k);

    const out = await withRerank(retrieve, rerank, 4)("q", 2);

    expect(askedFor).toBe(4);
    expect(out.map((h) => h.chunk.id)).toEqual(["d", "c"]);
  });
});
