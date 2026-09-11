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

---

# Week 2 — Open weights, served by me

## 20. The context window is a serving parameter, not a model property

**What it is.** A model is trained with a maximum context (`n_ctx_train`), but the
server decides how much of it to actually allocate. qwen2.5:7b is trained for
32,768 tokens; Ollama started it at **4,096**, chosen from available VRAM:

```
msg="vram-based default context" total_vram="11.8 GiB" default_num_ctx=4096
llama_context: n_ctx_seq (4096) < n_ctx_train (32768) -- the full capacity of the model will not be utilized
```

The reason it is not free to just ask for the maximum is the **KV cache**: every
token in the context keeps its key and value vectors in memory for the whole
generation. The cache is allocated up front for `n_ctx`, so context length is
bought with RAM, not with compute.

**Why it matters.** "Which model" is the question everyone asks. This is the one
nobody asks, and here it was worth four times the accuracy — the same weights on
the same machine scored 11% at 4k and 44% at 16k.

**Where you saw it.** `OLLAMA_CONTEXT_LENGTH=16384 ollama serve`, and the "Local
models" section of [`EVALS.md`](EVALS.md).

---

## 21. Silent prompt truncation

**What it is.** When the prompt does not fit, the server does not fail — it drops
tokens and answers anyway:

```
msg="truncating input prompt" limit=2050 prompt=4731 keep=4 new=2050
```

`keep=4` means it preserved four tokens from the front (the chat template's
opening) and discarded the rest of the beginning: the whole column context and
half the candidates. The HTTP response was a normal 200 with a well-formed JSON
body. Nothing in the OpenAI-compatible API surface reports it.

Note also `limit=2050`, not 4096: the server reserves the other half of the
window for the answer it is about to generate. **The usable prompt is roughly
half of `n_ctx`**, not all of it.

**Why it matters.** This is the worst failure class there is — wrong output that
looks exactly like right output. The only visible symptom in the harness was
`Answered 61%`, and that number is only visible because week 1 built a coverage
metric. Without it the run would have looked like "the local model is bad".

**Where you saw it.** The Ollama server log, cross-read against the `Answered`
column in [`EVALS.md`](EVALS.md).

---

## 22. Quantisation, and why it was not the problem

**What it is.** `qwen2.5:7b` is `Q4_K_M`: weights stored at ~4 bits instead of 16,
so a 7.6B model occupies 4.7 GB instead of ~15 GB. `K_M` is the k-quant family at
medium size — some tensors (attention, the output layer) keep more bits than
others, because not all weights tolerate the same rounding.

**Why it matters.** Quantisation is where the attention goes when a local model
underperforms, and here it was **the wrong suspect**: the 33-point swing came
from the context window, with the quantisation identical in both runs. Rank the
serving configuration above the weight format when something looks wrong.

**Where you saw it.** `ollama list` → `qwen2.5:7b Q4_K_M 4.68 GB`, and the two
rows in EVALS.md that share it.

---

## 23. Prefill vs decode

**What it is.** Two different regimes in one request. **Prefill** processes the
whole prompt in parallel — compute-bound, fast per token. **Decode** produces the
answer one token at a time, each pass re-reading the entire KV cache —
memory-bandwidth-bound, and it cannot be parallelised across tokens.

**Why it matters.** It explains why the correct run was *slower* (148s vs 73s)
while being *better*: it prefilled 4,731 tokens instead of 2,050 and then decoded
1,642 instead of 1,011. It also says where optimisation effort goes — on a laptop
the ceiling is memory bandwidth during decode, not FLOPS.

**Where you saw it.** The `Latency` and `Tokens in/out` columns for the two
qwen2.5:7b rows in [`EVALS.md`](EVALS.md).

---

## 24. Local does not mean safe: flat confidence

**What it is.** qwen2.5:7b returned 0.95-0.96 confidence on almost every verdict —
0.96 when right, 0.95 when wrong. The distributions are indistinguishable.

**Why it matters.** `LOW_CONFIDENCE_THRESHOLD = 0.7` (`src/lib/contracts.ts:134`) is
built on the assumption that confidence separates good answers from bad ones. For
this model it does not, so the gate would pass all ten wrong verdicts to the user
as high-confidence suggestions. Compare `gpt-oss-120b` at 0.84/0.60, where the
gate is doing real work.

**Concept 6 said calibration has to be measured. This is the case where a model
that is merely mediocre becomes dangerous instead**, because the mediocrity is
invisible downstream.

**Where you saw it.** The `Conf. right/wrong` column, and
`LOW_CONFIDENCE_THRESHOLD` at `src/lib/contracts.ts:134`, applied in
`src/components/workspace/diff.tsx:83`.

---

## 25. The same per-category collapse, from a different model

**What it is.** qwen2.5:7b scores 1/3, 4/5 and 3/4 on the three cell-level issue
types — and **0/6** on `fuzzy_duplicate`. Its rationales identify the duplicates
correctly (*"'Carlos Ruíz' and 'Carlos Ruiz' are likely the same person"*) and
then return `no_action` anyway.

**Why it matters.** `gpt-oss-safeguard-20b` failed in week 1 with the exact same
shape: 3/3, 5/5, 4/4, then 0/6. Two unrelated models, two providers, one shared
weakness — deciding to **delete** something is a different task from deciding to
correct it, and small models will describe the duplicate rather than act on it.

This is the strongest argument yet for the week-3 router: the failure is
per-category and therefore routable, and it says a router keyed on issue type
beats one keyed on model size.

**Where you saw it.** The "Accuracy by issue type" tables in
[`EVALS.md`](EVALS.md), week 1 and week 2 side by side.

---

## 26. The prefix cache, and the benchmark that measured it

**What it is.** Both llama.cpp and Ollama keep the KV cache of the last prompt.
Send a prompt sharing a prefix with it and the server skips prefill for the
shared part. Send the *identical* prompt and it skips prefill entirely.

**Why it matters.** The first version of `bench.py` sent the same prompt on every
repetition and reported **25,972 tok/s of prefill** — about a hundred times what
an M1 Pro can do. It was timing a cache lookup. A nonce at the front of each run
(the front, so the whole prefix is invalidated) brought it to 248 tok/s, which is
the real figure.

The generalisation: **a benchmark measures the whole stack, including the parts
built to avoid the work you meant to time.** Whenever a number comes out an order
of magnitude too good, look for what got skipped before believing it.

**Where you saw it.** `vary()` in `labs/local-inference/bench.py`, its
`--reuse-cache` flag, and the two numbers in
[`EVALS.md`](EVALS.md#a-benchmark-that-measured-the-cache).

---

## 27. What more bits actually buy

**What it is.** The same weights at Q4_K_M (4.7 GB) and Q8_0 (8.1 GB), on the
same 18 candidates: **44% and 39%**. One candidate apart on an 18-item set — no
measurable accuracy difference — for 1.7× the memory.

**Why it matters.** Concept 22 said quantisation was the wrong suspect for the
33-point context-window swing. This is the direct test of that claim, and it
holds: three of the four issue types score *identically* at both precisions, and
the `fuzzy_duplicate` collapse (0/6) survives at 8 bits intact. **A model's
refusal to delete a row is a judgment, not a rounding error**, and no amount of
precision addresses it.

The practical rule for a laptop: take the smallest quantisation that holds the
score, and spend the memory you saved on context window instead — which *is*
worth 33 points.

**Where you saw it.** The Q8_0 table in
[`EVALS.md`](EVALS.md#q8_0-twice-the-bits-no-accuracy).

---

## 28. The memory arithmetic of serving

**What it is.** What a served model occupies is weights + KV cache + activations,
against a budget that is not all of RAM. Ollama reports the budget on this
machine as `gpu memory ... library=Metal available="11.3 GiB"` — 75% of 16 GB,
because macOS will not let the GPU wire down more than that.

The KV cache is the part that is easy to forget:

    2 (K and V) × layers × kv_heads × head_dim × bytes × tokens

For qwen2.5-7B — 28 layers, 4 KV heads (GQA), 128 dims, fp16 — that is ~56 KB per
token, so a 16k window reserves ~0.9 GB whether or not it is filled. The measured
resident sizes match: 4.74 GB at 4k → 5.61 GB at 16k.

**Why it matters.** It is what rules FP16 out here without an experiment: 7.62 B
parameters × 2 bytes is ~15.2 GB of weights against an 11.3 GiB budget. It also
explains the shape of the throughput table — the window costs RAM, not speed,
so the right move is to buy the window and pay in memory.

**Where you saw it.** The `Resident` column in
[`EVALS.md`](EVALS.md#throughput-prefill-and-decode-measured), and the
`sched.go` memory lines in the Ollama server log.

---

## 29. The serving stack is not free

**What it is.** The same GGUF, the same machine, the same prompt, run three ways:
`llama-bench` at 239.8 tok/s prefill, `llama-server` at a matched 16k window at
233.8, and Ollama at 203.8. Decode is the same everywhere (~22 tok/s). Ollama
*is* llama.cpp underneath, and it still costs **~13% of prefill**.

**Why it matters.** Two things. First, the convenience layer has a price, and
it is worth knowing its size before optimising anything else — 13% is smaller
than the 33 points a bad context window cost, and larger than the 4% flash
attention was worth here. Second, this is how a measurement gets trusted:
`bench.py` driving `llama-server` landed within 2.5% of `llama-bench`, the tool
the llama.cpp project ships for exactly this, which is what makes the Ollama gap
a finding rather than a bug in my script.

**Where you saw it.** [`EVALS.md`](EVALS.md#the-serving-stack-costs-13-of-prefill),
and `labs/local-inference/README.md` for how llama.cpp was built.

---

## 30. Comparing runtimes is harder than comparing models

**What it is.** The same model in two runtimes: MLX at 4,030 tok/s prefill and
185 tok/s decode, llama.cpp at 3,189 and 156. MLX wins by ~25% — except the MLX
build is 265 MB and the GGUF is 374 MB for the same 494 M parameters, because
`Q4_K_M` keeps some tensors above 4 bits and the MLX build does not. **The
comparison is confounded**: fewer bits means fewer bytes to move, and decode is
bandwidth-bound.

**Why it matters.** A runtime benchmark has to hold the weights constant, and
"both are 4-bit" is not constant. Two further traps showed up in the same
afternoon: MLX's first run is a third of its later speed because it compiles
Metal kernels on first use, and Ollama's overhead against llama.cpp *inverts*
between 0.5B (matches on prefill, 15% behind on decode) and 7B (13% behind on
prefill, matches on decode) — so a result at one size predicts nothing at
another.

The habit this leaves: before reporting that A beats B, write down what else
changed between A and B. Here it was the quantisation scheme, the warm-up state,
and the model size — three confounds in a two-row table.

**Where you saw it.** [`EVALS.md`](EVALS.md#mlx-vs-llamacpp-at-a-size-that-fits-the-bandwidth-available).

---

## To read on your own (week 2)

- GGUF k-quants: what `Q4_K_M` protects and what it rounds away
- Flash attention and paged KV cache (`kv_unified`, the slots in the server log)
- Speculative decoding, and why it helps decode but not prefill
- MLX vs llama.cpp on Apple Silicon: unified memory, Metal kernels
- Continuous batching — the concept week 6's vLLM work is built on

---

## 31. One run is not a property

**What it is.** Week 1 measured `gpt-oss-safeguard-20b` at **0/6** on
`fuzzy_duplicate` and wrote that down as a per-category weakness — the fact the
whole week-3 router was designed around. Three runs later, at `temperature: 0`
and on the same prompt: **6/6**, then 0/6, then 0/6. Its other three categories
are identical to the verdict in all three runs.

**Why it matters.** The model is not weak at duplicates; it is **bimodal** —
it either commits to deleting all six or refuses all six. A single observation of
a bimodal variable looks exactly like a property, and every conclusion drawn from
it inherits a coin flip. Concept 7 said `temperature: 0` is not determinism; this
is what that costs when a design decision is built on one sample.

The repair is cheap and was available all along: `npm run eval -- --repeat 3`.
Anything that is going to become an architectural decision gets repeated first.

**Where you saw it.** The five `gpt-oss-safeguard-20b` rows in
[`EVALS.md`](EVALS.md#routing-week-3).

---

## 32. What routing actually buys

**What it is.** The router scores 94% — exactly what `gpt-oss-120b` scores alone.
The headline is a tie. But across three runs the router scored 17/18 every time,
while the model it replaces on 12 of the 18 candidates swung between 17/18 and
11/18.

**Why it matters.** The intuition behind routing is "cheap model where it is good
enough, expensive model where it is not", and that framing predicts a **cost**
win. The measured win is a **variance** win: the system's score stopped depending
on which mode the cheap model woke up in. The cost win was real but small — 6%,
because splitting a batch means sending the shared prompt prefix twice.

Both halves are worth carrying forward: a router is a reliability device that
happens to save money, and the thing to optimise is not the routing table but the
duplicated prefix.

**Where you saw it.** [`EVALS.md`](EVALS.md#the-router-did-not-raise-the-ceiling-it-raised-the-floor),
and `src/lib/llm/router.ts`.

---

## 33. Load balancing is not routing

**What it is.** The proxy can put two models behind one name and send each
request to whichever is answering faster. Asked to review the same 18 candidates
that way, it scored **11/18** — against 17/18 for the same models addressed
deliberately.

**Why it matters.** Load balancing distributes *load*. It is indifferent to
quality, so pointing it at deployments that differ in quality means the answer
you get is the answer you happened to get. This is the line between the week's
two builds, and it is not about which layer is more capable:

| Belongs in the app (`router.ts`) | Belongs in the proxy (LiteLLM) |
|---|---|
| which model should see this issue type | retries, cooldowns, failover to another model |
| decisions justified by the eval table | virtual keys, per-key budgets, spend logs |
| anything you would want a test for | anything you would want to change without deploying |

**Where you saw it.** The `proxy-any` row in
[`EVALS.md`](EVALS.md#through-the-proxy-with-prices-attached-labsgateway).

---

## 34. A gateway is where prices live

**What it is.** Every call this repo makes is on a free tier, so `llm_usage`
records tokens and the cost column has always been a blank. Routing the same
calls through LiteLLM produced `$0.002048` for the single model and `$0.001929`
for the router, per batch, from the proxy's own cost map.

**Why it matters.** The 6% saving in concept 32 is only sayable because something
in the path knew what a token costs. That is a real reason to run a gateway that
has nothing to do with routing: it is the one place that sees every call, so it
is the only place that can price them, cap them (`max_budget` on a virtual key)
and attribute them. The app's own `llm_usage` table answers "how many tokens";
the gateway answers "how many dollars, and who spent them".

**Where you saw it.** `/spend/logs` on the proxy, and the cost table in
[`EVALS.md`](EVALS.md#through-the-proxy-with-prices-attached-labsgateway).

---
