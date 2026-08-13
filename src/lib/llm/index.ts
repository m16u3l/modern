import { AnthropicLlm, DEFAULT_ANTHROPIC_MODEL } from "./anthropic";
import { FakeLlm } from "./fake";
import { OpenAiCompatibleLlm } from "./openai-compatible";
import type { LlmPort, ReviewInput, ReviewOutput } from "./port";

export * from "./port";
export { AnthropicLlm } from "./anthropic";
export { FakeLlm } from "./fake";
export { OpenAiCompatibleLlm } from "./openai-compatible";

export type ProviderId = "anthropic" | "openai-compatible" | "fake";

/** The variables the factory reads. Accepts process.env or a literal in tests. */
export type LlmEnv = {
  LLM_PROVIDER?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  OPENAI_COMPATIBLE_BASE_URL?: string;
  OPENAI_COMPATIBLE_API_KEY?: string;
  OPENAI_COMPATIBLE_MODEL?: string;
  [key: string]: string | undefined;
};

/**
 * Picks the adapter from the environment, falling back to the fake one whenever
 * credentials are missing. A deployment without an API key still runs the whole
 * pipeline end to end — it just stops escalating to a model.
 */
export function getLlm(env: LlmEnv = process.env): LlmPort {
  const requested = (env.LLM_PROVIDER ?? "fake") as ProviderId;

  if (requested === "anthropic" && env.ANTHROPIC_API_KEY) {
    return new AnthropicLlm({
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL,
    });
  }

  if (
    requested === "openai-compatible" &&
    env.OPENAI_COMPATIBLE_BASE_URL &&
    env.OPENAI_COMPATIBLE_MODEL
  ) {
    return new OpenAiCompatibleLlm({
      // Local runtimes such as Ollama ignore the key but the SDK requires one.
      apiKey: env.OPENAI_COMPATIBLE_API_KEY || "not-needed",
      baseURL: env.OPENAI_COMPATIBLE_BASE_URL,
      model: env.OPENAI_COMPATIBLE_MODEL,
    });
  }

  return new FakeLlm();
}

/** True when the configured provider is a real model rather than the stub. */
export function isLiveProvider(env: LlmEnv = process.env): boolean {
  return getLlm(env).id !== "fake";
}

export type ReviewAttempt = {
  review: ReviewOutput;
  /** The provider that actually answered, which is what usage is recorded against. */
  provider: LlmPort;
  /** Set only when the configured provider failed and the stub took over. */
  degradedFrom?: { provider: string; reason: string };
};

/**
 * A provider that is configured and then fails — rate limit, expired credit,
 * a bad gateway — must not strand the run: the batch falls through to the
 * deterministic stub and the pipeline still finishes. Missing credentials
 * already degrade at `getLlm`; this is the same promise kept at call time.
 *
 * If the stub itself is the one that failed there is nothing left to fall back
 * to, so the error propagates.
 */
export async function reviewWithFallback(
  primary: LlmPort,
  input: ReviewInput,
  fallback: LlmPort = new FakeLlm(),
): Promise<ReviewAttempt> {
  try {
    return { review: await primary.reviewCandidates(input), provider: primary };
  } catch (error) {
    if (primary.id === fallback.id) throw error;

    return {
      review: await fallback.reviewCandidates(input),
      provider: fallback,
      degradedFrom: {
        provider: primary.id,
        reason: error instanceof Error ? error.message : "the model call failed",
      },
    };
  }
}
