import { AnthropicLlm, DEFAULT_ANTHROPIC_MODEL } from "./anthropic";
import { FakeLlm } from "./fake";
import { OpenAiCompatibleLlm } from "./openai-compatible";
import type { LlmPort } from "./port";

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
