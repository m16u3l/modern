import { z } from "zod";
import {
  suggestionActionSchema,
  type ColumnProfile,
  type DataRow,
  type IssueType,
} from "@/lib/contracts";

/**
 * The boundary between the pipeline and whichever model is behind it. Everything
 * upstream of this file is deterministic and testable without a network; every
 * provider lives behind this one interface.
 */

export type CandidateIssue = {
  /** The issue this candidate came from. Echoed back so verdicts can be matched. */
  id: string;
  type: IssueType;
  columnKey?: string;
  evidence: string;
  /** The row in question, plus any related rows (the other half of a duplicate). */
  rows: Array<Pick<DataRow, "id" | "rowIndex" | "data">>;
  currentValue: string | null;
};

export type ReviewInput = {
  /**
   * Rendered column profiles. Identical for every batch of the same dataset,
   * which is what makes it worth caching on the provider side.
   */
  columnContext: string;
  candidates: CandidateIssue[];
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
};

export const llmVerdictSchema = z.object({
  candidateId: z.string(),
  rowId: z.string(),
  action: suggestionActionSchema,
  proposedValue: z.string().nullable(),
  confidence: z.number(),
  rationale: z.string(),
});

export const llmBatchSchema = z.object({
  verdicts: z.array(llmVerdictSchema),
});

export type LlmVerdict = z.infer<typeof llmVerdictSchema>;

export type ReviewOutput = {
  verdicts: LlmVerdict[];
  usage: TokenUsage;
};

export interface LlmPort {
  /** Stable identifier for logging and the cost panel. */
  readonly id: string;
  readonly model: string;
  reviewCandidates(input: ReviewInput): Promise<ReviewOutput>;
}

export const BATCH_SIZE = 25;
export const EMPTY_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
};

export const SYSTEM_PROMPT = `You are a data quality reviewer. You are given the profile of a CSV's columns and a batch of ambiguous issues that a deterministic rules engine could not resolve on its own.

For each candidate, decide what should happen and return one verdict per candidate.

Rules:
- Echo back the candidateId and rowId exactly as given. Never invent one.
- Choose "set_value" or "normalize_value" only when you can state the exact replacement. Put it in proposedValue.
- Choose "delete_row" for a record that duplicates another or is clearly not a real record.
- Choose "no_action" when the value may well be correct, or when you cannot recover the intended value. Set proposedValue to null.
- confidence is between 0 and 1 and must reflect genuine uncertainty. Two similar names are not necessarily the same person; say so with a low number instead of guessing high.
- rationale is one sentence a human reviewer can check. State the evidence, not your reasoning process.
- Never invent data that is not recoverable from the row or the column profile.`;

/** Renders the cacheable, batch-invariant half of the prompt. */
export function renderColumnContext(
  columns: ColumnProfile[],
  rowCount: number,
): string {
  const lines = columns.map((column) => {
    const samples = column.sampleValues
      .slice(0, 10)
      .map((value) => JSON.stringify(value))
      .join(", ");
    return `- ${column.key}: type=${column.inferredType}, missing=${column.nullCount}, distinct=${column.distinctCount}, samples=[${samples}]`;
  });

  return `Dataset: ${rowCount} rows, ${columns.length} columns.\n\nColumn profiles:\n${lines.join("\n")}`;
}

/** Renders the per-batch half. Kept separate so the cached prefix stays stable. */
export function renderCandidates(candidates: CandidateIssue[]): string {
  return candidates
    .map((candidate) => {
      const rows = candidate.rows
        .map(
          (row) =>
            `    row ${row.rowIndex + 1} (id ${row.id}): ${JSON.stringify(row.data)}`,
        )
        .join("\n");

      return [
        `- candidateId: ${candidate.id}`,
        `  issue: ${candidate.type}`,
        candidate.columnKey ? `  column: ${candidate.columnKey}` : null,
        `  currentValue: ${JSON.stringify(candidate.currentValue)}`,
        `  whyFlagged: ${candidate.evidence}`,
        `  rows:\n${rows}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

export function buildUserPrompt(input: ReviewInput): string {
  return `${input.columnContext}\n\nCandidates to review (${input.candidates.length}):\n\n${renderCandidates(input.candidates)}`;
}

/**
 * Everything a model returns passes through here. Verdicts that point at rows or
 * candidates that do not exist are dropped, confidence is clamped, and a
 * proposal with nothing to propose is demoted to no_action. A hallucination
 * should never reach the review UI, let alone the database.
 */
export function sanitizeVerdicts(
  verdicts: unknown,
  candidates: CandidateIssue[],
): LlmVerdict[] {
  const parsed = llmBatchSchema.safeParse(
    Array.isArray(verdicts) ? { verdicts } : verdicts,
  );
  if (!parsed.success) return [];

  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const seen = new Set<string>();
  const clean: LlmVerdict[] = [];

  for (const verdict of parsed.data.verdicts) {
    const candidate = byId.get(verdict.candidateId);
    if (!candidate) continue;
    if (seen.has(verdict.candidateId)) continue;

    const rowExists = candidate.rows.some((row) => row.id === verdict.rowId);
    if (!rowExists) continue;

    const confidence = Number.isFinite(verdict.confidence)
      ? Math.min(1, Math.max(0, verdict.confidence))
      : 0;

    const needsValue =
      verdict.action === "set_value" || verdict.action === "normalize_value";
    const action =
      needsValue && verdict.proposedValue === null ? "no_action" : verdict.action;

    seen.add(verdict.candidateId);
    clean.push({
      candidateId: verdict.candidateId,
      rowId: verdict.rowId,
      action,
      proposedValue: action === "no_action" ? null : verdict.proposedValue,
      confidence,
      rationale: verdict.rationale.trim().slice(0, 500),
    });
  }

  return clean;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

/** Exponential backoff for the rate limits every provider enforces differently. */
export async function withRetry<T>(
  operation: () => Promise<T>,
  { attempts = 4, baseDelayMs = 500 } = {},
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === attempts - 1) throw error;
      const delay = baseDelayMs * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

function isRetryable(error: unknown): boolean {
  const status = (error as { status?: number; statusCode?: number })?.status ??
    (error as { statusCode?: number })?.statusCode;
  return status === 429 || status === 500 || status === 502 || status === 503 ||
    status === 529;
}
