import OpenAI from "openai";
import { z } from "zod";
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

/**
 * One adapter for every provider that speaks the OpenAI chat API: Groq, Google
 * Gemini's compatibility endpoint, OpenRouter, DeepSeek and a local Ollama all
 * work by changing two environment variables. That is the reason the port
 * exists — a second provider costs a config change, not a rewrite.
 */
export class OpenAiCompatibleLlm implements LlmPort {
  readonly id = "openai-compatible";
  readonly model: string;
  private readonly client: OpenAI;

  constructor(options: { apiKey: string; baseURL: string; model: string }) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
    });
    this.model = options.model;
  }

  async reviewCandidates(input: ReviewInput): Promise<ReviewOutput> {
    const messages = [
      { role: "system" as const, content: `${SYSTEM_PROMPT}\n\n${input.columnContext}` },
      { role: "user" as const, content: buildUserPrompt(input) },
    ];

    const completion = await withRetry(async () => {
      try {
        return await this.client.chat.completions.create({
          model: this.model,
          temperature: 0,
          messages,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "verdicts",
              strict: true,
              schema: z.toJSONSchema(llmBatchSchema, { target: "draft-7" }),
            },
          },
        });
      } catch (error) {
        // Plenty of free models accept json_object but not a full schema.
        if (!isSchemaUnsupported(error)) throw error;
        return this.client.chat.completions.create({
          model: this.model,
          temperature: 0,
          messages: [
            ...messages,
            {
              role: "system" as const,
              content:
                'Reply with JSON only, shaped as {"verdicts": [{"candidateId": string, "rowId": string, "action": string, "proposedValue": string|null, "confidence": number, "rationale": string}]}.',
            },
          ],
          response_format: { type: "json_object" },
        });
      }
    });

    const content = completion.choices[0]?.message?.content ?? "";

    return {
      verdicts: sanitizeVerdicts(safeJsonParse(content), input.candidates),
      usage: {
        inputTokens: completion.usage?.prompt_tokens ?? 0,
        outputTokens: completion.usage?.completion_tokens ?? 0,
        cachedTokens:
          completion.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      },
    };
  }
}

function isSchemaUnsupported(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  const message = String((error as { message?: string })?.message ?? "");
  return status === 400 && /json_schema|response_format|schema/i.test(message);
}

/** Models sometimes wrap JSON in prose or a fenced block. Recover what we can. */
function safeJsonParse(content: string): unknown {
  const trimmed = content.trim();
  const candidates = [
    trimmed,
    trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```$/, ""),
  ];

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) candidates.push(trimmed.slice(start, end + 1));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      continue;
    }
  }
  return null;
}
