import { describe, expect, it } from "vitest";
import {
  BATCH_SIZE,
  buildUserPrompt,
  chunk,
  getLlm,
  renderColumnContext,
  sanitizeVerdicts,
  withRetry,
  FakeLlm,
  AnthropicLlm,
  OpenAiCompatibleLlm,
  type CandidateIssue,
  type LlmPort,
} from "./index";
import { FIXTURE_ROWS } from "@/lib/fixtures";
import { computeColumnStats } from "@/lib/profiling";

const HEADERS = Object.keys(FIXTURE_ROWS[0].data);
const COLUMNS = computeColumnStats(FIXTURE_ROWS, HEADERS);

const CANDIDATES: CandidateIssue[] = [
  {
    id: "cand-1",
    type: "fuzzy_duplicate",
    evidence: "Row 39 is 96% similar to row 1.",
    rows: [FIXTURE_ROWS[38], FIXTURE_ROWS[0]],
    currentValue: null,
  },
  {
    id: "cand-2",
    type: "suspicious_value",
    columnKey: "email",
    evidence: '"olivia.brown@example,com" is not a valid address.',
    rows: [FIXTURE_ROWS[16]],
    currentValue: "olivia.brown@example,com",
  },
  {
    id: "cand-3",
    type: "missing_value",
    columnKey: "phone",
    evidence: "Empty phone.",
    rows: [FIXTURE_ROWS[9]],
    currentValue: null,
  },
];

const INPUT = {
  columnContext: renderColumnContext(COLUMNS, FIXTURE_ROWS.length),
  candidates: CANDIDATES,
};

/**
 * The contract every adapter must satisfy. The fake always runs; the real
 * providers join in only when this machine has credentials for them, so the
 * suite stays green offline and in CI.
 */
function contractFor(name: string, create: () => LlmPort | null) {
  describe(`${name} satisfies the LlmPort contract`, () => {
    const port = create();
    const maybe = port ? it : it.skip;

    maybe("returns one verdict per candidate, all well-formed", async () => {
      const { verdicts, usage } = await port!.reviewCandidates(INPUT);

      expect(verdicts.length).toBeGreaterThan(0);
      expect(verdicts.length).toBeLessThanOrEqual(CANDIDATES.length);

      const ids = new Set(CANDIDATES.map((c) => c.id));
      for (const verdict of verdicts) {
        expect(ids.has(verdict.candidateId)).toBe(true);
        expect(verdict.confidence).toBeGreaterThanOrEqual(0);
        expect(verdict.confidence).toBeLessThanOrEqual(1);
        expect(verdict.rationale.length).toBeGreaterThan(0);
        if (verdict.action === "no_action") {
          expect(verdict.proposedValue).toBeNull();
        }
      }

      expect(usage.inputTokens).toBeGreaterThanOrEqual(0);
      expect(usage.outputTokens).toBeGreaterThanOrEqual(0);
    }, 60_000);

    maybe("never returns a rowId outside the candidate it belongs to", async () => {
      const { verdicts } = await port!.reviewCandidates(INPUT);
      const byId = new Map(CANDIDATES.map((c) => [c.id, c]));

      for (const verdict of verdicts) {
        const candidate = byId.get(verdict.candidateId)!;
        expect(candidate.rows.some((row) => row.id === verdict.rowId)).toBe(true);
      }
    }, 60_000);
  });
}

contractFor("FakeLlm", () => new FakeLlm());

contractFor("AnthropicLlm", () =>
  process.env.ANTHROPIC_API_KEY
    ? new AnthropicLlm({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null,
);

contractFor("OpenAiCompatibleLlm", () =>
  process.env.OPENAI_COMPATIBLE_BASE_URL && process.env.OPENAI_COMPATIBLE_MODEL
    ? new OpenAiCompatibleLlm({
        apiKey: process.env.OPENAI_COMPATIBLE_API_KEY || "not-needed",
        baseURL: process.env.OPENAI_COMPATIBLE_BASE_URL,
        model: process.env.OPENAI_COMPATIBLE_MODEL,
      })
    : null,
);

describe("getLlm", () => {
  it("falls back to the fake adapter when the key is missing", () => {
    expect(getLlm({ LLM_PROVIDER: "anthropic" }).id).toBe(
      "fake",
    );
  });

  it("selects Anthropic when configured", () => {
    const llm = getLlm({
      LLM_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "sk-test",
    });

    expect(llm.id).toBe("anthropic");
  });

  it("selects any OpenAI-compatible provider from two variables", () => {
    const llm = getLlm({
      LLM_PROVIDER: "openai-compatible",
      OPENAI_COMPATIBLE_BASE_URL: "https://api.groq.com/openai/v1",
      OPENAI_COMPATIBLE_MODEL: "llama-3.3-70b-versatile",
      OPENAI_COMPATIBLE_API_KEY: "gsk-test",
    });

    expect(llm.id).toBe("openai-compatible");
    expect(llm.model).toBe("llama-3.3-70b-versatile");
  });
});

describe("sanitizeVerdicts", () => {
  const valid = {
    candidateId: "cand-2",
    rowId: FIXTURE_ROWS[16].id,
    action: "set_value" as const,
    proposedValue: "olivia.brown@example.com",
    confidence: 0.9,
    rationale: "Comma where the dot should be.",
  };

  it("keeps a well-formed verdict", () => {
    expect(sanitizeVerdicts({ verdicts: [valid] }, CANDIDATES)).toHaveLength(1);
  });

  it("drops verdicts for candidates that were never sent", () => {
    const hallucinated = { ...valid, candidateId: "cand-999" };
    expect(sanitizeVerdicts({ verdicts: [hallucinated] }, CANDIDATES)).toEqual([]);
  });

  it("drops verdicts pointing at a row outside the candidate", () => {
    const wrongRow = { ...valid, rowId: "r-01" };
    expect(sanitizeVerdicts({ verdicts: [wrongRow] }, CANDIDATES)).toEqual([]);
  });

  it("clamps confidence into range", () => {
    const [low] = sanitizeVerdicts(
      { verdicts: [{ ...valid, confidence: -3 }] },
      CANDIDATES,
    );
    const [high] = sanitizeVerdicts(
      { verdicts: [{ ...valid, confidence: 42 }] },
      CANDIDATES,
    );

    expect(low.confidence).toBe(0);
    expect(high.confidence).toBe(1);
  });

  it("demotes a proposal with nothing to propose", () => {
    const [verdict] = sanitizeVerdicts(
      { verdicts: [{ ...valid, proposedValue: null }] },
      CANDIDATES,
    );

    expect(verdict.action).toBe("no_action");
  });

  it("keeps only the first verdict per candidate", () => {
    const verdicts = sanitizeVerdicts(
      { verdicts: [valid, { ...valid, confidence: 0.1 }] },
      CANDIDATES,
    );

    expect(verdicts).toHaveLength(1);
    expect(verdicts[0].confidence).toBe(0.9);
  });

  it("survives garbage instead of throwing", () => {
    expect(sanitizeVerdicts(null, CANDIDATES)).toEqual([]);
    expect(sanitizeVerdicts("not json", CANDIDATES)).toEqual([]);
    expect(sanitizeVerdicts({ verdicts: "nope" }, CANDIDATES)).toEqual([]);
    expect(sanitizeVerdicts({ verdicts: [{ candidateId: 1 }] }, CANDIDATES)).toEqual([]);
  });

  it("accepts a bare array as well as the wrapped object", () => {
    expect(sanitizeVerdicts([valid], CANDIDATES)).toHaveLength(1);
  });
});

describe("prompt construction", () => {
  it("sends the column profile, never the whole dataset", () => {
    const prompt = buildUserPrompt(INPUT);

    expect(prompt).toContain("Column profiles:");
    // Only the rows attached to a candidate appear, not all 40.
    const mentioned = FIXTURE_ROWS.filter((row) =>
      prompt.includes(`id ${row.id}`),
    );
    expect(mentioned.length).toBeLessThanOrEqual(4);
  });

  it("keeps the cacheable context identical between batches", () => {
    const a = renderColumnContext(COLUMNS, FIXTURE_ROWS.length);
    const b = renderColumnContext(COLUMNS, FIXTURE_ROWS.length);
    expect(a).toBe(b);
  });
});

describe("batching and retries", () => {
  it("splits candidates into batches", () => {
    const items = Array.from({ length: 60 }, (_, i) => i);
    const batches = chunk(items, BATCH_SIZE);

    expect(batches).toHaveLength(3);
    expect(batches.flat()).toHaveLength(60);
  });

  it("retries a rate-limited call and then succeeds", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw Object.assign(new Error("rate limited"), { status: 429 });
        return "ok";
      },
      { baseDelayMs: 1 },
    );

    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("does not retry a request that will never succeed", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw Object.assign(new Error("bad request"), { status: 400 });
        },
        { baseDelayMs: 1 },
      ),
    ).rejects.toThrow("bad request");

    expect(calls).toBe(1);
  });
});
