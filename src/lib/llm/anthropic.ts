import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  llmBatchSchema,
  sanitizeVerdicts,
  withRetry,
  type LlmPort,
  type ReviewInput,
  type ReviewOutput,
} from "./port";

export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";

/**
 * Uses structured outputs rather than asking for JSON in the prompt: the same
 * Zod schema is the API contract and the runtime validation, so a malformed
 * response is impossible by construction rather than caught after the fact.
 */
export class AnthropicLlm implements LlmPort {
  readonly id = "anthropic";
  readonly model: string;
  private readonly client: Anthropic;

  constructor(options: { apiKey: string; model?: string }) {
    this.client = new Anthropic({ apiKey: options.apiKey });
    this.model = options.model ?? DEFAULT_ANTHROPIC_MODEL;
  }

  async reviewCandidates(input: ReviewInput): Promise<ReviewOutput> {
    const message = await withRetry(() =>
      this.client.messages.parse({
        model: this.model,
        max_tokens: 4096,
        temperature: 0,
        system: [
          { type: "text", text: SYSTEM_PROMPT },
          {
            type: "text",
            text: input.columnContext,
            // The column profile is byte-identical across every batch of a
            // dataset, so it is worth caching rather than re-sending.
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: buildUserPrompt(input) }],
        output_config: { format: zodOutputFormat(llmBatchSchema) },
      }),
    );

    return {
      verdicts: sanitizeVerdicts(message.parsed_output, input.candidates),
      usage: {
        inputTokens: message.usage.input_tokens ?? 0,
        outputTokens: message.usage.output_tokens ?? 0,
        cachedTokens: message.usage.cache_read_input_tokens ?? 0,
      },
    };
  }
}
