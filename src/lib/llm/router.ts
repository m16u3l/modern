import type { IssueType } from "@/lib/contracts";
import {
  type CandidateIssue,
  type LlmPort,
  type LlmVerdict,
  type ReviewInput,
  type ReviewOutput,
  type TokenUsage,
  type UsageBreakdown,
} from "./port";

/**
 * One model is rarely the right answer for every kind of question. Week 1's
 * accuracy-by-issue-type table (see EVALS.md) showed `gpt-oss-safeguard-20b`
 * matching the 120B on `missing_value`, `type_mismatch` and `suspicious_value`
 * at half the latency, and collapsing to 0/6 on `fuzzy_duplicate`. That is a
 * routing decision the numbers already made: send the duplicates to the large
 * model and everything else to the cheap one.
 *
 * The router is itself an `LlmPort`, so it satisfies the same contract as a
 * single adapter and the pipeline cannot tell the difference.
 */

export type Route = {
  /** Issue types this port answers for. */
  types: IssueType[];
  port: LlmPort;
};

export class RouterLlm implements LlmPort {
  readonly id = "router";
  readonly model: string;
  private readonly routes: Route[];
  private readonly fallback: LlmPort;

  constructor(options: { routes: Route[]; fallback: LlmPort }) {
    this.routes = options.routes;
    this.fallback = options.fallback;
    this.model = [
      ...options.routes.map(
        (route) => `${route.types.join("|")}→${route.port.model}`,
      ),
      `*→${options.fallback.model}`,
    ].join(", ");
  }

  async reviewCandidates(input: ReviewInput): Promise<ReviewOutput> {
    const batches = this.partition(input.candidates);

    const settled = await Promise.allSettled(
      batches.map(({ port, candidates }) =>
        port.reviewCandidates({ ...input, candidates }),
      ),
    );

    // A route that fails takes down its own candidates, not the batch. The ones
    // it was carrying come back unanswered, which the pipeline already handles
    // by giving each a card for a human (`unansweredCandidates`). Only when
    // every route failed is there nothing to return, and then the error
    // propagates so `reviewWithFallback` can degrade to the stub.
    const answered = settled.filter(
      (result): result is PromiseFulfilledResult<ReviewOutput> =>
        result.status === "fulfilled",
    );
    if (answered.length === 0) {
      throw (settled[0] as PromiseRejectedResult).reason;
    }

    const breakdown: UsageBreakdown[] = [];
    const verdicts: LlmVerdict[] = [];

    settled.forEach((result, index) => {
      if (result.status !== "fulfilled") return;
      const { port } = batches[index];
      verdicts.push(...result.value.verdicts);
      breakdown.push({
        provider: port.id,
        model: port.model,
        usage: result.value.usage,
      });
    });

    return {
      verdicts: inInputOrder(verdicts, input.candidates),
      usage: sumUsage(breakdown),
      breakdown,
    };
  }

  /** Groups the batch by destination, so each port is called once. */
  private partition(
    candidates: CandidateIssue[],
  ): Array<{ port: LlmPort; candidates: CandidateIssue[] }> {
    const byPort = new Map<LlmPort, CandidateIssue[]>();

    for (const candidate of candidates) {
      const port = this.portFor(candidate.type);
      const existing = byPort.get(port);
      if (existing) existing.push(candidate);
      else byPort.set(port, [candidate]);
    }

    return [...byPort].map(([port, batch]) => ({ port, candidates: batch }));
  }

  portFor(type: IssueType): LlmPort {
    return (
      this.routes.find((route) => route.types.includes(type))?.port ??
      this.fallback
    );
  }
}

/**
 * Verdicts come back grouped by route. Restoring the order they were asked in
 * keeps the router's output indistinguishable from a single model's, which is
 * what lets it drop into the same eval harness and the same pipeline.
 */
function inInputOrder(
  verdicts: LlmVerdict[],
  candidates: CandidateIssue[],
): LlmVerdict[] {
  const rank = new Map(candidates.map((candidate, index) => [candidate.id, index]));
  return [...verdicts].sort(
    (a, b) =>
      (rank.get(a.candidateId) ?? 0) - (rank.get(b.candidateId) ?? 0),
  );
}

function sumUsage(breakdown: UsageBreakdown[]): TokenUsage {
  return breakdown.reduce(
    (total, entry) => ({
      inputTokens: total.inputTokens + entry.usage.inputTokens,
      outputTokens: total.outputTokens + entry.usage.outputTokens,
      cachedTokens: total.cachedTokens + entry.usage.cachedTokens,
    }),
    { inputTokens: 0, outputTokens: 0, cachedTokens: 0 },
  );
}
