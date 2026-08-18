/**
 * Measures models against the same 18 ambiguous candidates the pipeline would
 * escalate, scored on the fixtures' known-correct answers.
 *
 *   npm run eval                        # every model with a key present
 *   npm run eval -- --models gpt-oss-120b,llama-3.3-70b
 *   npm run eval -- --repeat 3          # variance across identical runs
 *
 * The point is to replace "gpt-oss-120b felt better than llama-3.3" with a
 * table. Everything upstream of the model call is deterministic, so two runs of
 * the same model on the same day differ only by the model itself.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FIXTURE_ROWS,
  FIXTURE_SUGGESTIONS,
} from "../src/lib/fixtures";
import { profileDataset, splitFindings } from "../src/lib/profiling";
import { FakeLlm, OpenAiCompatibleLlm } from "../src/lib/llm";
import {
  renderColumnContext,
  unansweredCandidates,
  type CandidateIssue,
  type LlmPort,
  type LlmVerdict,
} from "../src/lib/llm/port";
import type { Finding } from "../src/lib/profiling/detectors";
import type { SuggestionAction } from "../src/lib/contracts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// The models under test
// ---------------------------------------------------------------------------

type ModelSpec = {
  label: string;
  baseURL: string;
  model: string;
  /** Provider-specific key. Falls back to OPENAI_COMPATIBLE_API_KEY when the
   *  base URL is the one already configured in .env.local. */
  apiKeyEnv: string;
  /** USD per million tokens, for the cost column. 0 marks a free tier. */
  price?: { input: number; output: number };
};

const GROQ = "https://api.groq.com/openai/v1";
const GEMINI = "https://generativelanguage.googleapis.com/v1beta/openai/";
const OPENROUTER = "https://openrouter.ai/api/v1";
const OLLAMA = "http://localhost:11434/v1";

// Verified against GET /v1/models on 2026-08-18. Model catalogues churn fast —
// four IDs that looked obvious from memory (llama-3.3-70b-versatile among them)
// no longer exist on Groq at all. Re-check the endpoint before adding entries.
const MODELS: ModelSpec[] = [
  { label: "gpt-oss-120b", baseURL: GROQ, model: "openai/gpt-oss-120b", apiKeyEnv: "GROQ_API_KEY" },
  { label: "gpt-oss-20b", baseURL: GROQ, model: "openai/gpt-oss-20b", apiKeyEnv: "GROQ_API_KEY" },
  { label: "gpt-oss-safeguard-20b", baseURL: GROQ, model: "openai/gpt-oss-safeguard-20b", apiKeyEnv: "GROQ_API_KEY" },
  { label: "qwen3.6-27b", baseURL: GROQ, model: "qwen/qwen3.6-27b", apiKeyEnv: "GROQ_API_KEY" },
  { label: "allam-2-7b", baseURL: GROQ, model: "allam-2-7b", apiKeyEnv: "GROQ_API_KEY" },
  { label: "groq-compound", baseURL: GROQ, model: "groq/compound", apiKeyEnv: "GROQ_API_KEY" },
  { label: "groq-compound-mini", baseURL: GROQ, model: "groq/compound-mini", apiKeyEnv: "GROQ_API_KEY" },
  { label: "gemini-2.0-flash", baseURL: GEMINI, model: "gemini-2.0-flash", apiKeyEnv: "GEMINI_API_KEY" },
  { label: "gemini-2.5-flash", baseURL: GEMINI, model: "gemini-2.5-flash", apiKeyEnv: "GEMINI_API_KEY" },
  { label: "deepseek-r1-free", baseURL: OPENROUTER, model: "deepseek/deepseek-r1:free", apiKeyEnv: "OPENROUTER_API_KEY" },
  { label: "ollama-local", baseURL: OLLAMA, model: process.env.OLLAMA_MODEL ?? "llama3.1", apiKeyEnv: "OLLAMA_NO_KEY" },
];

// ---------------------------------------------------------------------------
// Ground truth
// ---------------------------------------------------------------------------

type Truth = { action: SuggestionAction; proposedValue: string | null; via: "cell" | "row" };

/**
 * The fixtures record the correct fix per cell, but the rules engine does not
 * always route a cell through the detector the fixture author expected — three
 * of the malformed emails arrive as `type_mismatch` and also as
 * `suspicious_value`, and r-13's phone arrives with no cell-level spec at all.
 * So candidates are matched on (column, row) rather than on issue type, with a
 * row marked for deletion answering for any cell inside it. That covers all 18.
 */
function buildTruth(): Map<string, Truth> {
  const truth = new Map<string, Truth>();
  for (const suggestion of FIXTURE_SUGGESTIONS) {
    truth.set(cellKey(suggestion.columnKey, suggestion.rowId), {
      action: suggestion.action,
      proposedValue: suggestion.proposedValue,
      via: "cell",
    });
  }
  return truth;
}

const DELETED_ROWS = new Set(
  FIXTURE_SUGGESTIONS.filter((s) => s.action === "delete_row").map((s) => s.rowId),
);

function cellKey(columnKey: string | undefined, rowId: string): string {
  return `${columnKey ?? ""}|${rowId}`;
}

function truthFor(truth: Map<string, Truth>, candidate: CandidateIssue): Truth | undefined {
  const rowId = candidate.rows[0]?.id;
  if (!rowId) return undefined;
  const cell = truth.get(cellKey(candidate.columnKey, rowId));
  if (cell) return cell;
  if (DELETED_ROWS.has(rowId)) return { action: "delete_row", proposedValue: null, via: "row" };
  return undefined;
}

// ---------------------------------------------------------------------------
// The candidates, built exactly as the enrich route builds them
// ---------------------------------------------------------------------------

function buildCandidates(): { candidates: CandidateIssue[]; columnContext: string } {
  const headers = Object.keys(FIXTURE_ROWS[0].data);
  const { columns, findings } = profileDataset(FIXTURE_ROWS, headers);
  const { ambiguous } = splitFindings(findings);
  const rowsById = new Map(FIXTURE_ROWS.map((row) => [row.id, row]));

  const candidates = ambiguous.map((finding: Finding, index: number) => {
    const rows = finding.issue.rowIds
      .map((rowId) => rowsById.get(rowId))
      .filter((row): row is NonNullable<typeof row> => row !== undefined);
    const primary = rows[0];

    return {
      id: `cand-${String(index + 1).padStart(3, "0")}`,
      type: finding.issue.type,
      columnKey: finding.issue.columnKey,
      evidence: finding.issue.evidence,
      rows,
      currentValue:
        finding.issue.columnKey && primary
          ? (primary.data[finding.issue.columnKey] ?? null)
          : null,
    };
  });

  return {
    candidates: candidates.filter((candidate) => candidate.rows.length > 0),
    columnContext: renderColumnContext(columns, FIXTURE_ROWS.length),
  };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

type Score = {
  label: string;
  model: string;
  ok: boolean;
  error?: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  total: number;
  answered: number;
  /** Same action label as the fixture. */
  actionCorrect: number;
  /** Same resulting repair, ignoring set_value/normalize_value labelling. */
  effectiveCorrect: number;
  /** Verdicts asking for merge_rows, which the apply step silently ignores. */
  noopMerges: number;
  /** Candidates whose correct answer names a replacement value. */
  valueExpected: number;
  valueCorrect: number;
  confidenceWhenRight: number;
  confidenceWhenWrong: number;
  byType: Record<string, { total: number; correct: number }>;
  misses: Array<{
    candidate: string;
    type: string;
    cell: string;
    expected: string;
    got: string;
    confidence: number;
    rationale: string;
  }>;
};

function score(
  label: string,
  model: string,
  candidates: CandidateIssue[],
  verdicts: LlmVerdict[],
  truth: Map<string, Truth>,
  latencyMs: number,
  usage: { inputTokens: number; outputTokens: number },
): Score {
  const byCandidate = new Map(verdicts.map((verdict) => [verdict.candidateId, verdict]));
  const unanswered = new Set(
    unansweredCandidates(candidates, verdicts).map((candidate) => candidate.id),
  );

  const result: Score = {
    label,
    model,
    ok: true,
    latencyMs,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    total: candidates.length,
    answered: candidates.length - unanswered.size,
    actionCorrect: 0,
    effectiveCorrect: 0,
    noopMerges: 0,
    valueExpected: 0,
    valueCorrect: 0,
    confidenceWhenRight: 0,
    confidenceWhenWrong: 0,
    byType: {},
    misses: [],
  };

  const right: number[] = [];
  const wrong: number[] = [];

  for (const candidate of candidates) {
    const expected = truthFor(truth, candidate);
    if (!expected) continue;

    const bucket = (result.byType[candidate.type] ??= { total: 0, correct: 0 });
    bucket.total += 1;

    const verdict = byCandidate.get(candidate.id);
    if (verdict?.action === expected.action) result.actionCorrect += 1;
    if (verdict?.action === "merge_rows") result.noopMerges += 1;

    const effectiveMatch =
      verdict !== undefined && EFFECT[verdict.action] === EFFECT[expected.action];

    if (effectiveMatch) {
      result.effectiveCorrect += 1;
      bucket.correct += 1;
      right.push(verdict.confidence);
    } else {
      if (verdict) wrong.push(verdict.confidence);
      result.misses.push({
        candidate: candidate.id,
        type: candidate.type,
        cell: cellKey(candidate.columnKey, candidate.rows[0].id),
        expected: expected.action,
        got: verdict?.action ?? "(no answer)",
        confidence: verdict?.confidence ?? 0,
        rationale: verdict?.rationale ?? "",
      });
    }

    // A value is only scorable when the correct answer names one.
    if (expected.proposedValue !== null) {
      result.valueExpected += 1;
      if (normalize(verdict?.proposedValue) === normalize(expected.proposedValue)) {
        result.valueCorrect += 1;
      }
    }
  }

  result.confidenceWhenRight = mean(right);
  result.confidenceWhenWrong = mean(wrong);
  return result;
}

/**
 * `apply.ts` routes set_value and normalize_value down the same branch — both
 * write proposedValue into the cell — so choosing between those two labels is a
 * naming preference, not a different repair. Scoring them as distinct made
 * gpt-oss-120b look 39% wrong when it had produced the correct replacement
 * string in every one of those cases. Strict accuracy is still reported, but
 * the headline number is the one that matches what the app actually does.
 *
 * merge_rows is its own class on purpose: it is in the schema but `apply.ts`
 * never acts on it, so a model choosing it produces a silent no-op.
 */
const EFFECT: Record<SuggestionAction, string> = {
  set_value: "write",
  normalize_value: "write",
  delete_row: "delete",
  merge_rows: "merge (never applied)",
  no_action: "keep",
};

const normalize = (value: string | null | undefined): string =>
  (value ?? "").trim().toLowerCase();

const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

function resolveKey(spec: ModelSpec): string | undefined {
  const direct = process.env[spec.apiKeyEnv];
  if (direct) return direct;
  // Lets the harness run today with only the Groq key that is already set.
  if (process.env.OPENAI_COMPATIBLE_BASE_URL === spec.baseURL) {
    return process.env.OPENAI_COMPATIBLE_API_KEY;
  }
  if (spec.baseURL === OLLAMA) return "not-needed";
  return undefined;
}

function parseArgs(): { models?: string[]; repeat: number } {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + 1];
  };
  const models = get("--models");
  return {
    models: models ? models.split(",").map((entry) => entry.trim()) : undefined,
    repeat: Number(get("--repeat") ?? 1),
  };
}

async function main() {
  const { models: wanted, repeat } = parseArgs();
  const { candidates, columnContext } = buildCandidates();
  const truth = buildTruth();

  const scorable = candidates.filter((candidate) => truthFor(truth, candidate));
  console.log(
    `${candidates.length} ambiguous candidates, ${scorable.length} with ground truth.\n`,
  );

  const selected = MODELS.filter(
    (spec) => !wanted || wanted.includes(spec.label) || wanted.includes(spec.model),
  );

  const scores: Score[] = [];

  // The deterministic stub is the floor: any model that cannot beat it is not
  // earning its latency.
  scores.push(await runOnce("fake (baseline)", new FakeLlm(), candidates, columnContext, truth));

  for (const spec of selected) {
    const apiKey = resolveKey(spec);
    if (!apiKey) {
      console.log(`- ${spec.label}: skipped, no ${spec.apiKeyEnv}`);
      continue;
    }

    for (let attempt = 1; attempt <= repeat; attempt++) {
      const label = repeat > 1 ? `${spec.label} #${attempt}` : spec.label;
      const llm = new OpenAiCompatibleLlm({ apiKey, baseURL: spec.baseURL, model: spec.model });
      scores.push(await runOnce(label, llm, candidates, columnContext, truth));
      // Free tiers meter per minute and the adapter's backoff only covers 429s
      // it actually receives. Spacing the runs keeps the table comparable.
      await sleep(2000);
    }
  }

  report(scores);
  writeRun(scores);
}

async function runOnce(
  label: string,
  llm: LlmPort,
  candidates: CandidateIssue[],
  columnContext: string,
  truth: Map<string, Truth>,
): Promise<Score> {
  process.stdout.write(`- ${label} ... `);
  const started = Date.now();

  try {
    const { verdicts, usage } = await llm.reviewCandidates({ columnContext, candidates });
    const result = score(label, llm.model, candidates, verdicts, truth, Date.now() - started, usage);
    console.log(`${result.effectiveCorrect}/${result.total} in ${(result.latencyMs / 1000).toFixed(1)}s`);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`failed — ${message.slice(0, 80)}`);
    return {
      label, model: llm.model, ok: false, error: message,
      latencyMs: Date.now() - started, inputTokens: 0, outputTokens: 0,
      total: candidates.length, answered: 0, actionCorrect: 0, effectiveCorrect: 0, noopMerges: 0,
      valueExpected: 0, valueCorrect: 0, confidenceWhenRight: 0,
      confidenceWhenWrong: 0, byType: {}, misses: [],
    };
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function report(scores: Score[]) {
  const pct = (n: number, d: number) => (d === 0 ? "—" : `${((n / d) * 100).toFixed(0)}%`);
  const types = [...new Set(scores.flatMap((s) => Object.keys(s.byType)))].sort();

  console.log("\n## Overall\n");
  console.log("| Model | Repair acc. | Strict | Value acc. | Answered | No-op merges | Latency | Tokens in/out | Conf. right/wrong |");
  console.log("|---|---|---|---|---|---|---|---|---|");
  for (const s of scores) {
    if (!s.ok) {
      console.log(`| ${s.label} | failed | — | — | — | — | — | — | ${s.error?.slice(0, 40)} |`);
      continue;
    }
    console.log(
      `| ${s.label} | ${pct(s.effectiveCorrect, s.total)} (${s.effectiveCorrect}/${s.total}) ` +
        `| ${pct(s.actionCorrect, s.total)} ` +
        `| ${pct(s.valueCorrect, s.valueExpected)} (${s.valueCorrect}/${s.valueExpected}) ` +
        `| ${pct(s.answered, s.total)} | ${s.noopMerges} | ${(s.latencyMs / 1000).toFixed(1)}s ` +
        `| ${s.inputTokens}/${s.outputTokens} ` +
        `| ${s.confidenceWhenRight.toFixed(2)}/${s.confidenceWhenWrong.toFixed(2)} |`,
    );
  }

  // The table the week-3 router is built from: nobody wins everywhere.
  console.log("\n## Accuracy by issue type\n");
  console.log(`| Model | ${types.join(" | ")} |`);
  console.log(`|---|${types.map(() => "---").join("|")}|`);
  for (const s of scores.filter((entry) => entry.ok)) {
    const cells = types.map((type) => {
      const bucket = s.byType[type];
      return bucket ? `${bucket.correct}/${bucket.total}` : "—";
    });
    console.log(`| ${s.label} | ${cells.join(" | ")} |`);
  }

  console.log("\n## Misses\n");
  for (const s of scores.filter((entry) => entry.ok && entry.misses.length > 0)) {
    console.log(`### ${s.label}`);
    for (const miss of s.misses) {
      console.log(
        `- \`${miss.cell}\` (${miss.type}): expected **${miss.expected}**, got ` +
          `**${miss.got}** @ ${miss.confidence.toFixed(2)}` +
          (miss.rationale ? ` — "${miss.rationale}"` : ""),
      );
    }
    console.log();
  }
}

function writeRun(scores: Score[]) {
  const dir = path.join(root, "evals");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `run-${stamp}.json`);
  writeFileSync(file, JSON.stringify({ ranAt: new Date().toISOString(), scores }, null, 2));
  console.log(`Wrote ${path.relative(root, file)}`);
}

await main();
