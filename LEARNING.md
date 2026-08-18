# Concepts

Study log. Every concept that shows up while building gets written down in the
moment: **what it is → why it matters → where you saw it**. The goal is not code
that works, it is being able to explain why it works.

Full plan: [`PLAN.md`](PLAN.md). Results so far: [`EVALS.md`](EVALS.md).

---

# Week 1 — Evals

## 1. Eval harness

**What it is.** A program that runs several models over *exactly the same input*
and scores their output against known-correct answers. It is not a test: a test
passes or fails, an eval produces a number that is comparable across models.

**Why it matters.** This is the base skill. Without an eval, "this model is
better" is an anecdote. With one it is a row in a table you can defend, and it is
the only thing that lets you decide routing, cost, and when a cheaper model is
good enough.

**Where you saw it.** `scripts/eval.mts`, `npm run eval`.

---

## 2. Ground truth

**What it is.** The set of known-correct answers you score against. Without
ground truth there is no eval, only output somebody has to read by hand.

**Why it matters.** Getting ground truth is usually 80% of the work of an eval.
This repo got lucky: `src/lib/fixtures.ts` already had it, because the tests
needed it.

**Where you saw it.** `FIXTURE_SUGGESTIONS` in `src/lib/fixtures.ts` — 47
hand-written specs with the correct action and value per cell.

---

## 3. Ground-truth alignment (the problem that showed up while building)

**What it is.** Matching each model output to its correct answer. Sounds trivial,
almost never is.

**What happened here.** The first attempt matched on `(issue_type, column, row)`
and only covered **14 of 18** candidates. Digging in: the rules engine routes
three malformed emails through the `type_mismatch` detector, while the fixture
had recorded them as `suspicious_value`. Same cell, same correct answer — only
the detector label disagreed.

Changing the key to `(column, row)` — plus a special case where a row marked for
deletion answers for any cell inside it — took coverage to **18/18**.

**Why it matters.** This is *the* classic eval bug: an over-strict match looks
like "the model failed" when really your harness did not know where to look.
Always report how many cases went unscored; never silently count them as a pass
or a fail.

**Where you saw it.** `buildTruth()` and `truthFor()` in `scripts/eval.mts`, and
the comment explaining why the key excludes the type.

---

## 4. Baseline

**What it is.** The floor everything is compared against. Here it is `FakeLlm`,
the deterministic stub that already existed to run the tests without a network.

**Why it matters.** A model that cannot beat the baseline is not earning its
latency or its cost. Measured: the stub scores **10/18**. Anything below that is
worse than calling no model at all.

**Where you saw it.** `src/lib/llm/fake.ts`; it always runs as the first row of
the table in `scripts/eval.mts`.

---

## 5. The metrics, and why there are several

A single metric always lies. What the harness measures:

| Metric | What it answers |
|---|---|
| **Action accuracy** | Did it pick the right action (`set_value`, `delete_row`, `no_action`…)? |
| **Value accuracy** | When the correct answer names a value, did it write it exactly? |
| **Answered / coverage** | How many candidates did it even respond to? |
| **Latency** | Wall-clock seconds for the whole call |
| **Tokens in/out** | The basis of cost |
| **Confidence right/wrong** | Calibration (see below) |

**Why it matters.** A model can have good action accuracy and terrible value
accuracy: it knows *that* the email needs fixing but invents the domain. Those
are different failures with different consequences.

**Where you saw it.** The `Score` type and the `score()` function in
`scripts/eval.mts`.

---

## 6. Confidence calibration

**What it is.** Whether the confidence number a model reports matches its real
probability of being right. A well-calibrated model is right ~90% of the time it
says 0.9.

**Why it matters.** This app's whole design depends on it:
`LOW_CONFIDENCE_THRESHOLD = 0.7` decides what can be bulk-accepted and what needs
a human. If the model is badly calibrated, that threshold protects nothing.

That is why the harness reports **mean confidence when right vs. when wrong**. If
the two numbers are close, the confidence carries no information. Measured on the
baseline: 0.72 right vs 0.52 wrong — reasonable separation.

**Where you saw it.** `confidenceWhenRight` / `confidenceWhenWrong` in
`scripts/eval.mts`; the threshold in `src/lib/contracts.ts`.

**To read separately.** Calibration, reliability diagrams, Expected Calibration
Error (ECE).

---

## 7. Determinism, and why `temperature: 0` is not enough

**What it is.** The same input producing the same output. Everything upstream of
the model call here is deterministic: fixed fixtures, detectors that are pure
functions, an identical prompt.

**Why it matters.** If the input varies between models, the table is not
comparing models, it is comparing noise. `temperature: 0` reduces model variance
but **does not eliminate it** — GPU batching and floating-point arithmetic mean
large providers are not bit-for-bit reproducible.

That is why the harness accepts `--repeat N`: running the same model several
times and seeing how much it moves is itself a data point.

**Where you saw it.** `temperature: 0` in `src/lib/llm/openai-compatible.ts`;
`--repeat` in `scripts/eval.mts`.

---

## 8. Structured outputs (and their degradation)

**What it is.** Forcing the model to return JSON that satisfies a schema, rather
than asking for it in the prompt and praying. Two levels:
- `response_format: { type: "json_schema", strict: true }` — the provider
  constrains generation to the schema. A real guarantee.
- `response_format: { type: "json_object" }` — only guarantees valid JSON, not
  the shape.

**Why it matters.** It is the difference between parsing with confidence and
writing defenses. And it is an axis of comparison between models: **plenty of
free models accept `json_object` but not a full schema**, so the adapter tries
strict schema first and falls back to `json_object` plus a prompt instruction
when the provider returns 400.

**Where you saw it.** `reviewCandidates()` and `isSchemaUnsupported()` in
`src/lib/llm/openai-compatible.ts`. The schema comes from Zod via
`z.toJSONSchema(llmBatchSchema)` — one schema is both API contract and runtime
validation.

---

## 9. Output sanitisation: treating the model as untrusted input

**What it is.** Validating and discarding everything the model returns before it
touches the database: verdicts pointing at rows or candidates that do not exist,
confidence outside [0,1], duplicates, and "here is a change" with no proposed
value.

**Why it matters.** Models hallucinate identifiers. Without this step a
hallucination reaches the review UI and from there the customer's data. The rule
is the same as for any external input: **never trust, validate**.

**Where you saw it.** `sanitizeVerdicts()` in `src/lib/llm/port.ts:135`.

---

## 10. Unanswered candidates

**What it is.** A model answers what it feels like. It can skip candidates, or
its answer can be thrown out by the sanitiser.

**Why it matters.** This is a silent-failure case: the issue is cleared from the
ambiguous queue **whether or not a verdict came back**, so without explicit
handling a detected problem would vanish unseen. The app fabricates a
low-confidence card for it so a human still looks.

In the eval it is a metric in its own right: *answered/total*. A model with 95%
accuracy over the 40% it bothered to answer is worse than one with 80% over
everything.

**Where you saw it.** `unansweredCandidates()` and `UNANSWERED_CONFIDENCE = 0.3`
in `src/lib/llm/port.ts`; used in `src/app/api/datasets/[id]/enrich/route.ts`.

---

## 11. Rate limits and exponential backoff

**What it is.** Providers cap requests per minute and tokens per minute. Going
over returns **429**. The correct response is to retry with growing waits
(500ms, 1s, 2s, 4s), not to retry in a loop.

**Why it matters.** On free tiers this is the number-one cause of an inconsistent
eval: half the rows fail on rate limits rather than model quality, and you walk
away with the wrong conclusion.

**Where you saw it.** `withRetry()` and `isRetryable()` in `src/lib/llm/port.ts`
(retries 429, 500, 502, 503, 529). The harness also spaces runs by 2s.

---

## 12. Accuracy by type: the table the router comes from

**What it is.** Breaking accuracy down per problem category instead of reporting
one global number.

**Why it matters.** No model wins at everything. The global number hides exactly
the information you need to make the system cheaper: if a small model ties the
big one on `missing_value` and only loses on `fuzzy_duplicate`, you send 80% of
traffic to the cheap one. That table is the direct input to week 3's router.

**Where you saw it.** `byType` in `scripts/eval.mts` and the "Accuracy by issue
type" section of the output.

---

## 13. The Port / Adapter pattern (already in the repo)

**What it is.** An interface (`LlmPort`) defining what the system needs from a
model, and interchangeable adapters implementing it (`anthropic`,
`openai-compatible`, `fake`). No provider-specific branching lives outside
`src/lib/llm/`.

**Why it matters.** This is *harness engineering*: the reason the eval could be
written in an afternoon is that models were already swappable without touching
the pipeline. In week 3 the router plugs in as one more adapter and **passes the
existing contract test unmodified** — that is the proof the abstraction was
placed correctly.

**Where you saw it.** `src/lib/llm/port.ts` (the interface),
`src/lib/llm/index.ts` (`getLlm()`, the factory that picks by env),
`src/lib/llm/port.test.ts` (the contract test every adapter must pass).

---

## 14. Metric design: action equivalence

**What happened.** The first version of the harness required the model to use the
fixture's exact label. `gpt-oss-120b` scored **61%** and looked mediocre.

Reviewing the misses: in all 6 cases the model had chosen `normalize_value` where
the fixture said `set_value`, and it had produced **the correct replacement
string in all 6**. And `apply.ts` executes both actions *through the same code
branch*: both write `proposedValue` into the cell. The distinction was a naming
preference, not a different repair.

Grouping actions by their real effect, the same model jumps to **94%**.

**Why it matters.** This is the most expensive kind of eval bug: **a badly
designed metric nearly discarded the best model**. The rule that comes out of it
is that the metric has to measure what the system actually does, not what the
prompt asked for. If two outputs produce the same downstream effect, scoring them
differently measures obedience, not quality.

Both are reported: `Repair acc.` (by effect, the headline) and `Strict` (by
label, useful for seeing instruction following).

**Where you saw it.** The `EFFECT` table in `scripts/eval.mts` and its comment.

---

## 15. When the schema is wider than the implementation

**What it is.** `suggestionActionSchema` includes `merge_rows`, but `apply.ts`
never executes it. It is a contract-valid action that in practice does nothing.

**What happened.** Both 20B models scored **0/6** on fuzzy duplicates — not
because they misunderstood the problem, their rationales were correct ("row 8 is
a near-duplicate of row 7") — but because they chose `merge_rows`. They detect
correctly and propose a nonexistent operation. The result is a **silent no-op**:
it looks like an answer and nothing happens.

**Why it matters.** An action enum is an API surface for the model. Any value you
expose, a model will use. If it is not implemented, take it out of the schema —
otherwise the model will pick the path that does nothing and your coverage metric
will read 100%.

The harness now counts `noopMerges` as its own column.

**Where you saw it.** `src/lib/contracts.ts:39` (the enum), `src/lib/apply.ts:106`
(the "merge_rows is never produced" comment), the *No-op merges* column in
`EVALS.md`.

---

## 16. Inverted calibration (the real case)

Extending concept 6, now with data:

| Model | Confidence when right | Confidence when wrong |
|---|---|---|
| gpt-oss-120b | 0.84 | 0.60 |
| gpt-oss-safeguard-20b | 0.86 | **0.95** |

`gpt-oss-safeguard-20b` is **more confident when it is wrong**. With
`LOW_CONFIDENCE_THRESHOLD = 0.7`, its six misses clear the bulk-accept filter and
reach the data unreviewed.

**Why it matters.** Calibration is not an academic detail: it is the variable a
confidence threshold depends on to protect anything. A model with good accuracy
and bad calibration is more dangerous than one with worse accuracy and honest
calibration, because the failure goes unnoticed.

---

## 17. Model catalogues expire

**What happened.** The harness's initial registry had six Groq models. **Four
returned 404**: `llama-3.3-70b-versatile`, `llama-3.1-8b-instant`,
`qwen/qwen3-32b`, `moonshotai/kimi-k2-instruct-0905`. They no longer exist at the
provider.

Concrete consequence: the comparison recorded in `PROGRESS.md`
("llama-3.3-70b answered no_action at 0.5") is against a **retired** model. It is
a result that can no longer be reproduced.

**Why it matters.** Model IDs are live data, not knowledge. The only source of
truth is the provider's endpoint:

```bash
curl -s https://api.groq.com/openai/v1/models -H "Authorization: Bearer $KEY"
```

And it is an argument for keeping evals versioned: a result without a date and an
exact model ID is worthless in six months.

**Where you saw it.** The comment on the `MODELS` registry in `scripts/eval.mts`.

---

## 18. "OpenAI-compatible" does not mean identical

**What it is.** All these providers speak the same API, but each has its own
restrictions. The ones that turned up in a single afternoon:

| Provider / model | What broke |
|---|---|
| `groq/compound`, `compound-mini` | 400 if the **last message is not from the user** |
| `qwen/qwen3.6-27b` | Cannot produce valid JSON for the schema, even on the fallback path |
| `allam-2-7b` | Context window smaller than the prompt (~4.2k tokens) |
| Groq (free) | 429 rate limit on the underlying model |

**And the bug this exposed in our own code:** the fallback path in
`openai-compatible.ts` appended the format instruction as a trailing `system`
message. For the `compound` models that was an automatic 400. Moving the
instruction into the user turn took `compound-mini` from failing outright to
**17/18**.

**Why it matters.** This is the entire argument for having an eval: the bug had
been there since the adapter was written and no manual run was going to find it,
because the default model did support `json_schema` and never took that branch.
**The measurement found the bug, not the debugging.**

**Where you saw it.** `reviewCandidates()` in
`src/lib/llm/openai-compatible.ts`, and the "What the eval found about the code
itself" section in `EVALS.md`.

---

## 19. The baseline, no longer as a concept but as a result

`gpt-oss-20b` scores **28%**. The deterministic stub scores **56%**.

A model from the same provider and the same family as the winner is **half as
good as calling no model at all** — while costing 2.5s of latency and 6k tokens
per batch.

**Why it matters.** It destroys the intuition that "if the big one is expensive,
use the small one and degrade a little". There is no guaranteed graceful
degradation: it has to be measured. And it is why week 3's router has to be built
from the per-type table, not from model size.

---

## To read on your own (week 1)

- Calibration: reliability diagrams, ECE
- LLM-as-a-judge: when it replaces hand-written ground truth, and its biases
- Precision vs. recall applied to issue detection (only accuracy is measured here)
- Benchmark contamination: why public benchmarks age badly
- Per-million token pricing for each provider, for the cost column
