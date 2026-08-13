import { normalizeKey, similarity } from "@/lib/profiling/values";
import {
  EMPTY_USAGE,
  type CandidateIssue,
  type LlmPort,
  type LlmVerdict,
  type ReviewInput,
  type ReviewOutput,
} from "./port";

/**
 * A deterministic stand-in for a model. It powers the contract test, keeps the
 * suite offline, and is what runs the public demo when no API key is configured
 * — the app degrades to "no LLM" rather than to "broken".
 */
export class FakeLlm implements LlmPort {
  readonly id = "fake";
  readonly model = "fake-deterministic";

  async reviewCandidates(input: ReviewInput): Promise<ReviewOutput> {
    return {
      verdicts: input.candidates.map(verdictFor),
      usage: EMPTY_USAGE,
    };
  }
}

function verdictFor(candidate: CandidateIssue): LlmVerdict {
  const primary = candidate.rows[0];
  const base = {
    candidateId: candidate.id,
    rowId: primary.id,
  };

  switch (candidate.type) {
    case "fuzzy_duplicate": {
      const other = candidate.rows[1];
      const score = other
        ? similarity(signature(primary.data), signature(other.data))
        : 0;
      return {
        ...base,
        action: score > 0.9 ? "delete_row" : "no_action",
        proposedValue: null,
        confidence: Number(score.toFixed(2)),
        rationale: other
          ? `Rows ${primary.rowIndex + 1} and ${other.rowIndex + 1} are ${(score * 100).toFixed(0)}% identical once formatting is stripped.`
          : "No counterpart row was supplied for comparison.",
      };
    }

    case "suspicious_value": {
      const repaired = repairEmail(candidate.currentValue);
      if (repaired) {
        return {
          ...base,
          action: "set_value",
          proposedValue: repaired,
          confidence: 0.8,
          rationale: `"${candidate.currentValue}" is one edit away from a valid address.`,
        };
      }
      return {
        ...base,
        action: "no_action",
        proposedValue: null,
        confidence: 0.4,
        rationale: "Looks wrong, but the intended value cannot be recovered.",
      };
    }

    case "missing_value":
      return {
        ...base,
        action: "no_action",
        proposedValue: null,
        confidence: 0.3,
        rationale: `No reliable way to recover ${candidate.columnKey ?? "this value"} from the rest of the row.`,
      };

    default:
      return {
        ...base,
        action: "no_action",
        proposedValue: null,
        confidence: 0.45,
        rationale: "Flagged for a human; nothing can be applied automatically.",
      };
  }
}

function signature(data: Record<string, string>): string {
  return Object.values(data).map(normalizeKey).join("|");
}

/** Repairs the two email defects that are mechanically recoverable. */
function repairEmail(value: string | null): string | null {
  if (!value || !value.includes("@")) return null;

  const commaFixed = value.replace(/,(?=[a-z]{2,4}$)/i, ".");
  if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(commaFixed)) return commaFixed;

  const [local, domain] = commaFixed.split("@");
  if (domain && !domain.includes(".")) return `${local}@${domain}.com`;

  return null;
}
