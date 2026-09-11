import { describe, expect, it } from "vitest";
import { FakeLlm, RouterLlm, type CandidateIssue, type LlmPort, type ReviewInput, type ReviewOutput } from "./index";
import { FIXTURE_ROWS } from "@/lib/fixtures";
import { computeColumnStats } from "@/lib/profiling";

const HEADERS = Object.keys(FIXTURE_ROWS[0].data);
const COLUMNS = computeColumnStats(FIXTURE_ROWS, HEADERS);

const DUPLICATE: CandidateIssue = {
  id: "cand-dup",
  type: "fuzzy_duplicate",
  evidence: "Row 39 is 96% similar to row 1.",
  rows: [FIXTURE_ROWS[38], FIXTURE_ROWS[0]],
  currentValue: null,
};

const SUSPICIOUS: CandidateIssue = {
  id: "cand-sus",
  type: "suspicious_value",
  columnKey: "email",
  evidence: '"olivia.brown@example,com" is not a valid address.',
  rows: [FIXTURE_ROWS[16]],
  currentValue: "olivia.brown@example,com",
};

const MISSING: CandidateIssue = {
  id: "cand-missing",
  type: "missing_value",
  columnKey: "phone",
  evidence: "Empty phone.",
  rows: [FIXTURE_ROWS[9]],
  currentValue: null,
};

/** Records what it was asked, then answers like the stub so verdicts stay valid. */
class SpyLlm implements LlmPort {
  readonly seen: CandidateIssue[][] = [];
  private readonly inner = new FakeLlm();

  constructor(
    readonly id: string,
    readonly model: string,
    private readonly failWith?: Error,
  ) {}

  async reviewCandidates(input: ReviewInput): Promise<ReviewOutput> {
    this.seen.push(input.candidates);
    if (this.failWith) throw this.failWith;
    const { verdicts } = await this.inner.reviewCandidates(input);
    return {
      verdicts,
      usage: { inputTokens: 100, outputTokens: 10, cachedTokens: 0 },
    };
  }
}

function inputFor(candidates: CandidateIssue[]): ReviewInput {
  return {
    columnContext: `${COLUMNS.length} columns, ${FIXTURE_ROWS.length} rows`,
    candidates,
  };
}

describe("RouterLlm", () => {
  it("sends each issue type to the port the eval picked for it", async () => {
    const large = new SpyLlm("openai-compatible", "large-model");
    const small = new SpyLlm("openai-compatible", "small-model");
    const router = new RouterLlm({
      routes: [{ types: ["fuzzy_duplicate"], port: large }],
      fallback: small,
    });

    await router.reviewCandidates(inputFor([DUPLICATE, SUSPICIOUS, MISSING]));

    expect(large.seen).toEqual([[DUPLICATE]]);
    expect(small.seen).toEqual([[SUSPICIOUS, MISSING]]);
  });

  it("calls each port once for the whole batch, not once per candidate", async () => {
    const small = new SpyLlm("openai-compatible", "small-model");
    const router = new RouterLlm({ routes: [], fallback: small });

    await router.reviewCandidates(inputFor([SUSPICIOUS, MISSING, DUPLICATE]));

    expect(small.seen).toHaveLength(1);
    expect(small.seen[0]).toHaveLength(3);
  });

  it("returns verdicts in the order the candidates were given", async () => {
    const router = new RouterLlm({
      routes: [
        {
          types: ["fuzzy_duplicate"],
          port: new SpyLlm("openai-compatible", "large-model"),
        },
      ],
      fallback: new SpyLlm("openai-compatible", "small-model"),
    });

    const { verdicts } = await router.reviewCandidates(
      inputFor([SUSPICIOUS, DUPLICATE, MISSING]),
    );

    expect(verdicts.map((verdict) => verdict.candidateId)).toEqual([
      "cand-sus",
      "cand-dup",
      "cand-missing",
    ]);
  });

  it("reports what each model spent, and their sum", async () => {
    const router = new RouterLlm({
      routes: [
        {
          types: ["fuzzy_duplicate"],
          port: new SpyLlm("openai-compatible", "large-model"),
        },
      ],
      fallback: new SpyLlm("openai-compatible", "small-model"),
    });

    const { usage, breakdown } = await router.reviewCandidates(
      inputFor([DUPLICATE, SUSPICIOUS]),
    );

    expect(breakdown?.map((entry) => entry.model).sort()).toEqual([
      "large-model",
      "small-model",
    ]);
    expect(usage).toEqual({ inputTokens: 200, outputTokens: 20, cachedTokens: 0 });
  });

  it("keeps the answers of the routes that worked when one fails", async () => {
    const router = new RouterLlm({
      routes: [
        {
          types: ["fuzzy_duplicate"],
          port: new SpyLlm("openai-compatible", "large-model", new Error("429")),
        },
      ],
      fallback: new SpyLlm("openai-compatible", "small-model"),
    });

    const { verdicts, breakdown } = await router.reviewCandidates(
      inputFor([DUPLICATE, SUSPICIOUS]),
    );

    // The duplicate comes back unanswered rather than taking the batch down;
    // the pipeline gives it a card for a human.
    expect(verdicts.map((verdict) => verdict.candidateId)).toEqual(["cand-sus"]);
    expect(breakdown).toHaveLength(1);
  });

  it("throws when every route failed, so the caller can degrade to the stub", async () => {
    const router = new RouterLlm({
      routes: [
        {
          types: ["fuzzy_duplicate"],
          port: new SpyLlm("openai-compatible", "large-model", new Error("429")),
        },
      ],
      fallback: new SpyLlm("openai-compatible", "small-model", new Error("503")),
    });

    await expect(
      router.reviewCandidates(inputFor([DUPLICATE, SUSPICIOUS])),
    ).rejects.toThrow();
  });

  it("names the routing table in its model string, for the cost panel", () => {
    const router = new RouterLlm({
      routes: [
        {
          types: ["fuzzy_duplicate"],
          port: new SpyLlm("openai-compatible", "large-model"),
        },
      ],
      fallback: new SpyLlm("openai-compatible", "small-model"),
    });

    expect(router.model).toBe("fuzzy_duplicate→large-model, *→small-model");
  });
});
