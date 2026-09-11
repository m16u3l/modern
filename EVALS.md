# Model evaluation

Produced by `npm run eval`. Every model receives **exactly the same 18 ambiguous
candidates** — the ones the rules engine cannot resolve on its own — and is
scored against the known-correct answers in `src/lib/fixtures.ts`.

Last run: **2026-08-28**. Providers: Groq (free tier) and, since week 2, models
served locally with Ollama — see [Local models](#local-models-week-2).
Raw runs in `evals/` (gitignored).

---

## How it is scored

| Metric | What it measures |
|---|---|
| **Repair acc.** | Does it produce the correct repair? `set_value` and `normalize_value` count as equivalent because `apply.ts` executes them through the same branch. **This is the headline number.** |
| **Strict** | Does it use the fixture's exact label? Useful for seeing instruction following, not repair quality. |
| **Value acc.** | When the correct answer names a replacement value, does it write it exactly? |
| **Answered** | How many candidates did it respond to? A model can simply skip them. |
| **No-op merges** | `merge_rows` verdicts, which are in the schema but which `apply.ts` **never applies**. They look like an answer and do nothing. |
| **Conf. ok/bad** | Mean confidence when right vs. when wrong. If they do not separate, the confidence carries no information. |

Ground truth is matched on `(column, row)`, with a row marked for deletion
answering for any cell inside it. **Coverage: 18/18.**

---

## Results

| Model | Repair acc. | Strict | Value acc. | Answered | No-op merges | Latency | Tokens in/out | Conf. ok/bad |
|---|---|---|---|---|---|---|---|---|
| **gpt-oss-120b** | **94%** (17/18) | 61% | 100% (6/6) | 100% | 0 | 6.2s | 4215/2614 | 0.84 / 0.60 |
| **groq/compound-mini** | **94%** (17/18) | 94% | 100% (6/6) | 100% | 0 | 9.3s | 8409/3950 | 0.86 / 0.95 |
| gpt-oss-safeguard-20b | 67% (12/18) | 33% | 100% (6/6) | 100% | 6 | 3.6s | 4215/2838 | 0.86 / 0.95 |
| *fake (baseline)* | *56%* (10/18) | 56% | 50% (3/6) | 100% | 0 | 0.0s | 0/0 | 0.72 / 0.52 |
| gpt-oss-20b | 28% (5/18) | 28% | 0% (0/6) | 100% | 6 | 2.5s | 4215/1874 | 0.90 / 0.85 |

The baseline is `FakeLlm`, the deterministic stub. It is the floor: any model
below it spends latency and money to make the result worse.

### Accuracy by issue type

| Model | missing_value | type_mismatch | suspicious_value | fuzzy_duplicate |
|---|---|---|---|---|
| gpt-oss-120b | 2/3 | **4/4** | **5/5** | **6/6** |
| groq/compound-mini | 2/3 | **4/4** | **5/5** | **6/6** |
| gpt-oss-safeguard-20b | **3/3** | **4/4** | **5/5** | 0/6 |
| fake (baseline) | 2/3 | 1/4 | 3/5 | 4/6 |
| gpt-oss-20b | 2/3 | 1/4 | 2/5 | 0/6 |

---

## Conclusions

**1. `gpt-oss-120b` is the pick.** It ties compound-mini on quality with half the
input tokens (4.2k vs 8.4k) and a third less latency. compound-mini is an agentic
system doing extra work internally; for this task that work buys nothing.

**2. `gpt-oss-20b` is worse than using no model.** 28% against the deterministic
stub's 56%. This is the most useful result in the table: it shows that "a smaller
model from the same provider" is not graceful degradation, it is a regression.

**3. Fuzzy duplicates split the table in two.** The 20B models score **0/6**, and
not for failing to understand the problem — their reasoning is correct ("row 8 is
a near-duplicate of row 7") — but because they pick `merge_rows`, an action that
exists in the schema and that `apply.ts` never executes. They detect correctly
and propose a nonexistent operation. The 120B and compound models score 6/6.

**4. Confidence calibration inverts on the small models.**
`gpt-oss-safeguard-20b` reports **0.86 when right and 0.95 when wrong**: it is
*more* certain exactly when it is mistaken. With `LOW_CONFIDENCE_THRESHOLD = 0.7`
its six misses would clear the bulk-accept filter unreviewed. `gpt-oss-120b`
separates cleanly (0.84 / 0.60).

**5. The per-type breakdown is the router's blueprint.**
`gpt-oss-safeguard-20b` matches the 120B on `missing_value` (3/3, better),
`type_mismatch` (4/4) and `suspicious_value` (5/5) — at **half the latency**. It
only collapses on `fuzzy_duplicate`. That is a routing decision waiting to be
made: small model for 12 of the 18 cases, large one only for the 6 duplicates.

---

## What the eval found about the code itself

Building the measurement surfaced two things no manual run would have shown:

- **A bug in our own adapter.** The fallback path in
  `src/lib/llm/openai-compatible.ts` (for models that do not support
  `json_schema`) appended its instruction as a trailing `system` message. Groq's
  `compound` models reject any request whose last message is not from the user
  with a 400. Moving the instruction into the user turn took `compound-mini` from
  *failing outright* to **17/18**.
- **A design flaw in the eval itself.** The first version required the exact
  label and gave `gpt-oss-120b` a 61%. But `apply.ts` executes `set_value` and
  `normalize_value` through the same branch: the model had produced the correct
  replacement string in 6 of 6 cases. Its real accuracy is 94%. **A badly
  designed metric nearly discarded the best model.**

---

## Local models (week 2)

Same 18 candidates, same scoring, served from this machine — Apple M1 Pro,
16 GB unified memory, Ollama 0.33.2, no API involved. Run **2026-08-28**.

| Model | Quant | Repair acc. | Strict | Value acc. | Answered | No-op merges | Latency | Tokens in/out | Conf. right/wrong |
|---|---|---|---|---|---|---|---|---|---|
| qwen2.5:7b @ 16k ctx | Q4_K_M | 44% (8/18) | 11% | 100% (6/6) | 100% | 0 | 148.1s | 4731/1642 | 0.96/0.95 |
| qwen2.5:7b @ 4k ctx | Q4_K_M | 11% (2/18) | 11% | 0% (0/6) | 61% | 6 | 73.3s | 2050/1011 | 0.90/0.90 |

Both rows are the same weights on the same machine. **The only difference is the
context window**, and it is worth four times the accuracy.

### The first run measured the serving, not the model

Ollama sizes its default context from available VRAM, and on this machine chose
`default_num_ctx=4096`. The eval prompt is ~4.7k tokens, so the server did this:

```
msg="truncating input prompt" limit=2050 prompt=4731 keep=4 new=2050
```

It dropped the front of the prompt — the column context and half the candidates —
and answered anyway. No error, no warning on the client side: the OpenAI-compatible
response is a normal 200. The visible symptoms were **61% answered** (the model
cannot answer candidates it never received) and 6 `merge_rows` no-ops.

Restarting with `OLLAMA_CONTEXT_LENGTH=16384` moved it to 44% / 100% answered /
0 no-ops. Nothing about the model changed.

**This is the local-serving equivalent of the `compound` bug in week 1**: a
configuration default silently degrading output, found by a number rather than by
reading the code.

### It still does not beat the stub

44% against the deterministic baseline's 56%. Locally served qwen2.5:7b costs
148 seconds per batch to be worse than calling no model at all — the same verdict
week 1 reached for `gpt-oss-20b` at 28%, now with the latency of a laptop instead
of a datacenter.

The collapse is entirely `fuzzy_duplicate`: **0/6**, every one answered
`no_action` with a rationale that correctly identifies the duplicate —
*"'Carlos Ruíz' and 'Carlos Ruiz' are likely the same person"* — and then declines
to act on it. Its other three categories (1/3, 4/5, 3/4) are respectable, and its
`value acc.` is a perfect 6/6: when it decides to write a replacement, the
replacement is right.

That is the same shape as `gpt-oss-safeguard-20b` in week 1 (also 0/6 on fuzzy
duplicates, strong everywhere else), and it is more evidence for the week-3
router: **this is a per-category weakness, not a general one.**

### Confidence carries no information here

0.96 when right, 0.95 when wrong. The model answered nearly every candidate at
0.95 regardless of outcome. The `LOW_CONFIDENCE_THRESHOLD` gate of 0.7 in the
review workspace would let **all ten wrong answers straight through**. Compare
`gpt-oss-120b`'s 0.84/0.60, where the gate does real work.

A local model is not automatically a safe one: the confidence signal has to be
measured per model before any threshold built on it means anything.

### Q8_0: twice the bits, no accuracy

Same weights at a second quantisation. Both rows re-run **2026-09-08** in one
sitting, because the 2026-08-28 row above was measured on a machine that had just
finished installing things and its latency is not comparable to anything.

| Model | Quant | On disk | Repair acc. | Strict | Value acc. | Latency | Tokens in/out | Conf. right/wrong |
|---|---|---|---|---|---|---|---|---|
| qwen2.5:7b @ 16k ctx | Q4_K_M | 4.7 GB | 44% (8/18) | 11% | 100% (6/6) | 100.0s | 4731/1642 | 0.96/0.95 |
| qwen2.5:7b-instruct-q8_0 @ 16k ctx | Q8_0 | 8.1 GB | 39% (7/18) | 6% | 100% (6/6) | 96.1s | 4731/1376 | 0.96/0.88 |

**Doubling the bits per weight bought nothing.** The one-candidate difference
(8/18 vs 7/18) is inside the noise of an 18-item set; what is not noise is that
the two runs are identical on three of the four issue types:

| Quant | fuzzy_duplicate | missing_value | suspicious_value | type_mismatch |
|---|---|---|---|---|
| Q4_K_M | 0/6 | 1/3 | 4/5 | 3/4 |
| Q8_0 | 0/6 | 0/3 | 4/5 | 3/4 |

The `fuzzy_duplicate` collapse — 0/6, the thing that keeps this model below the
56% stub — **is not a rounding artefact**. It survives at 8 bits, so it is the
model's judgment about deleting rows, not the quantisation, and no amount of
precision will fix it. The 44% row costs 4.7 GB; the 39% row costs 8.1 GB.

Q4_K_M also reproduced its 2026-08-28 score exactly (8/18, and the same
`value acc.` of 6/6), which is worth as much as any new number: the harness is
repeatable across eleven days on a locally served model.

FP16 was the third quantisation the plan asked for and **it does not fit on this
machine**: 7.62 B parameters at 16 bits is ~15.2 GB of weights against the
11.3 GiB Ollama reports Metal will give it (`gpu memory ... available="11.3 GiB"`,
75% of 16 GB). Not measured, ruled out by arithmetic.

### Throughput: prefill and decode, measured

`labs/local-inference/bench.py`, same 4,700-token prompt as the eval, 128 tokens
generated, median of 3 runs after a discarded warm-up. Ollama 0.33.2.

| Model | ctx | Prompt tok sent → seen | Prefill tok/s | Decode tok/s | Resident |
|---|---|---|---|---|---|
| qwen2.5:7b Q4_K_M | 4,096 | 4,700 → 2,050 **truncated** | 246.8 | 24.6 | 4.74 GB |
| qwen2.5:7b Q4_K_M | 8,192 | 4,700 → 4,724 | 198.9 | 21.9 | 5.12 GB |
| qwen2.5:7b Q4_K_M | 16,384 | 4,700 → 4,725 | 203.8 | 21.9 | 5.61 GB |
| qwen2.5:7b Q8_0 | 4,096 | 4,700 → 2,050 **truncated** | 275.3 | 19.4 | 7.88 GB |
| qwen2.5:7b Q8_0 | 8,192 | 4,700 → 4,725 | 259.4 | 18.4 | 8.12 GB |
| qwen2.5:7b Q8_0 | 16,384 | 4,700 → 4,726 | 256.9 | 18.3 | 8.60 GB |

Three things fall out of this table.

**Q8_0 prefills faster and decodes slower than Q4_K_M** — 257 vs 204 tok/s
prefill, 18.3 vs 21.9 tok/s decode. That is concept 23 showing up as two
numbers: prefill is compute-bound, and the K-quant's block unpacking costs
arithmetic that plain 8-bit does not; decode is memory-bandwidth-bound, so the
larger model streams more bytes per token and pays for it. It also explains why
the Q8 eval *finished sooner* (96.1s vs 100.0s) while being slower per token —
it generated 1,376 tokens instead of 1,642. Total latency is set by output length
as much as by speed.

**The context window costs memory, not speed.** 8k → 16k is 203.8 vs 198.9 tok/s
prefill, indistinguishable, against +0.5 GB resident. The KV cache is ~56 KB per
token here (28 layers × 4 KV heads × 128 dims × 2 × 2 bytes), so 16k of window is
~0.9 GB whether or not it is used. Given week 2's headline — a truncated window
cost 33 accuracy points — **the window should be sized generously and the price
paid in RAM.**

**Truncation is not "half the window", as this lab first wrote it.** The 4k rows
truncate a 4,725-token prompt to 2,050, but the 8k rows pass the same prompt
whole, and 4,725 is well past half of 8,192. The rule that fits both: the server
truncates only when the prompt exceeds the *whole* window, and then drops to
about half of it.

### The serving stack costs 13% of prefill

Same GGUF file, same machine, same 4,700-token prompt, three ways of running it:

| Stack | Context | Prefill tok/s | Decode tok/s |
|---|---|---|---|
| `llama-bench` (llama.cpp, compiled here) | sized to fit | 239.8 ± 1.7 | 24.4 ± 1.6 |
| `llama-server` at `-c 16384`, via `bench.py` | 16,384 | 233.8 | 22.2 |
| Ollama at `num_ctx=16384`, via `bench.py` | 16,384 | 203.8 | 21.9 |

Ollama runs llama.cpp underneath, and **serving the same weights through it costs
~13% of prefill throughput** (203.8 vs 233.8) while leaving decode alone. The KV
allocation is not the explanation — llama.cpp at the identical 16k window is
still 233.8 — and neither is flash attention, which `llama-bench -fa 0,1` puts at
4% (230.6 vs 240.6). What remains is Ollama's own request path.

The first two rows are also the check on the measurement: `bench.py` driving
`llama-server` lands within 2.5% of `llama-bench`, the canonical tool, on the
same stack.

### MLX vs llama.cpp, at a size that fits the bandwidth available

The plan wanted this at 7B. Hugging Face's CDN served this machine at ~300 KB/s
on 2026-09-08 — four hours for the 4.3 GB MLX build of Qwen2.5-7B, against 8 MB/s
from Ollama's registry for the GGUF — so the comparison was done at **0.5B**,
where both runtimes have the model in minutes. Same prompt, 3,979 tokens, 128
generated, median of 3.

| Runtime | Format | On disk | Prefill tok/s | Decode tok/s |
|---|---|---|---|---|
| MLX (`mlx_lm.generate`) | MLX 4-bit | 265 MB | 4,030 | 185.2 |
| llama.cpp (`llama-bench`) | GGUF Q4_K_M | 374 MB | 3,189 ± 5 | 156.3 ± 6 |
| Ollama (`bench.py`) | GGUF Q4_K_M | 374 MB | 3,206 | 133.6 |

MLX comes out ahead — 26% on prefill, 19% on decode against llama.cpp — but
**these are not identical weights**, and the disk sizes say so: 265 MB against
374 MB for the same 494 M parameters. `Q4_K_M` is a mixed scheme that keeps
attention and output tensors at higher precision; the MLX build is closer to
uniform 4-bit. Part of MLX's advantage is that it is carrying fewer bits, and
this measurement does not separate the runtime from the format.

Two caveats worth more than the ranking:

- **A 0.5B result does not transfer to 7B.** Ollama's prefill matches llama.cpp
  exactly here (3,206 vs 3,189) while costing 13% at 7B, and its decode is 15%
  *behind* here while matching at 7B. The overhead profile inverts between the
  two sizes, which is the clearest possible warning against extrapolating.
- **MLX's first run is a third of its speed**: 1,524 tok/s of prefill, then
  3,947 / 4,030 / 4,039 on the next three. It compiles its Metal kernels on first
  use. Benchmarking MLX without discarding a warm-up measures the compiler.

Peak memory is reported as 1.11 GB by MLX against 0.58 GB resident for Ollama,
but those are different quantities — MLX's peak includes activations for a
4k-token prompt, Ollama's is the model plus its KV allocation — and they are not
compared here.

### A benchmark that measured the cache

The first version of `bench.py` reported **25,972 tok/s of prefill**, which is
roughly a hundred times what this laptop can do. Both servers keep a prefix
cache: sending the identical prompt on every repetition meant every run after the
first skipped prefill entirely and timed a cache lookup. Prepending a nonce so
each run has a unique prefix brought it to 248 tok/s.

The flag is kept (`--reuse-cache`) because the wrong number is worth being able
to reproduce on demand:

```
qwen2.5:7b  248 tok/s prefill      # unique prefix per run
qwen2.5:7b  25,585 tok/s prefill   # --reuse-cache
```

Same shape as the two failures week 1 and week 2 already found: a default that
silently improves the number instead of the result.

---

## Routing (week 3)

The week-1 table said `gpt-oss-safeguard-20b` matched the 120B on three issue
types and scored **0/6** on `fuzzy_duplicate`. `src/lib/llm/router.ts` acts on
that: duplicates to the large model, everything else to the small one. It
implements `LlmPort`, so the harness scores it exactly like a model.

All runs **2026-09-09**, same 18 candidates.

| Run | Repair acc. | missing | type | suspicious | fuzzy | Latency | Tokens in |
|---|---|---|---|---|---|---|---|
| gpt-oss-120b #1 | 94% (17/18) | 2/3 | 4/4 | 5/5 | 6/6 | 5.5s | 4,215 |
| gpt-oss-120b #2 | 94% (17/18) | 2/3 | 4/4 | 5/5 | 6/6 | 5.2s | 4,215 |
| gpt-oss-safeguard-20b #1 | 94% (17/18) | 2/3 | 4/4 | 5/5 | **6/6** | 8.2s | 4,215 |
| gpt-oss-safeguard-20b #2 | 61% (11/18) | 2/3 | 4/4 | 5/5 | **0/6** | 52.5s | 4,215 |
| gpt-oss-safeguard-20b (earlier) | 61% (11/18) | 2/3 | 4/4 | 5/5 | **0/6** | 4.7s | 4,215 |
| **router** #1 | **94% (17/18)** | 3/3 | 4/4 | 5/5 | 5/6 | 31.1s | 5,918 |
| **router** #2 | **94% (17/18)** | 2/3 | 4/4 | 5/5 | 6/6 | 5.1s | 5,918 |
| **router** #3 | **94% (17/18)** | 2/3 | 4/4 | 5/5 | 6/6 | 34.6s | 5,918 |

### The router did not raise the ceiling. It raised the floor

94% is exactly what `gpt-oss-120b` scores on its own, so **the headline number
is a tie** — and anyone reporting the router as an improvement on the strength of
one run of each would be reporting noise.

What the repeats show instead is that the small model is **bimodal on
`fuzzy_duplicate`**: 6/6 in one run and 0/6 in two others, at `temperature: 0`,
same prompt, same day, with its other three categories identical to the token in
all three. It is not weak at duplicates; it either does all six or none of them.
Week 1 saw one run and wrote down "0/6 — a per-category weakness". That was half
of a coin flip recorded as a property.

The router scored 17/18 in all three of its runs. It is the only configuration
here that did. Sending the duplicates to the model that is 6/6 every time is what
makes the system's score stop depending on which mode the cheap model woke up in.
**That is the argument for routing: not a better average, a smaller variance.**

### Routing costs 40% more input tokens

The harness now prints where a routed batch went:

| Model | Tokens in/out |
|---|---|
| openai/gpt-oss-safeguard-20b | 3,132 / 2,087 |
| openai/gpt-oss-120b | 2,786 / 1,173 |
| **total** | **5,918** vs 4,215 for one model |

The 1,703-token difference is exactly the column context, which every route needs
and each one pays for. `port.ts` calls that prefix "identical for every batch of
the same dataset, which is what makes it worth caching on the provider side" —
and splitting the batch across two models is precisely what stops one cache from
covering it. **A router trades input tokens for routing**, and at two routes the
trade is +40% before a single verdict is produced.

Whether that trade pays depends on prices the free tier hides — which is what
the proxy below was able to answer.

### Through the proxy, with prices attached (labs/gateway)

[`labs/gateway`](labs/gateway/) puts a LiteLLM proxy in front of the same models,
so the app asks for `reviewer-large` and `reviewer-small` and never names a
vendor. The router runs unchanged against those names — the only edit was the
strings in the harness.

| Run | What it is | Repair acc. | Latency |
|---|---|---|---|
| proxy-large | one model, `reviewer-large` → 120B | 94% (17/18) | 7.7s |
| proxy-router | the app's router over the proxy's names | 94% (17/18) | 6.1s |
| proxy-any | the proxy load-balancing across both models | 61% (11/18) | 3.1s |

**`proxy-any` is the useful failure.** One name, two deployments, and
`latency-based-routing` picks whichever answers faster — which is the small
model, in whichever mode it happens to be in. Load balancing distributes *load*;
it has no opinion about quality, and asking it to make a quality decision gives
you 11/18. That is the line between the two builds this week: **which model
should see this issue belongs in the app, and everything about getting the call
through belongs in the proxy.**

And because the proxy prices every call from its own cost map, the question the
free tier could not answer becomes arithmetic:

| Run | Tokens in/out | Cost |
|---|---|---|
| single 120B, whole batch | 4,215 / 2,552 | **$0.002048** |
| router → safeguard-20b | 3,132 / 1,565 | $0.000646 |
| router → 120B | 2,786 / 1,441 | $0.001283 |
| **router, total** | 5,918 / 3,006 | **$0.001929** |

**The router is 6% cheaper at the same 94%** — after paying for the duplicated
prefix, and while producing *more* output tokens (3,006 vs 2,552), because two
thirds of them came from the model that charges less for them. Six percent is a
thin margin for the complexity, and it is thin for a specific reason: the 1,703
duplicated input tokens eat most of what routing saves. The lever that would
widen it is not a better routing table, it is not sending the prefix twice.

### Latency says nothing here

5.1s, 31.1s and 34.6s for identical work, against 5.2-8.2s for single models and
one 52.5s outlier among them. Free-tier queueing dominates everything else, so
these runs cannot support a latency claim in either direction. The router
dispatches its routes concurrently, so its floor is the slower of the two — the
5.1s run — but a floor observed once is not a measurement.

---

## Models that could not be measured

| Model | Reason |
|---|---|
| `qwen/qwen3.6-27b` | 400 — cannot produce valid JSON for the schema, nor on the fallback path |
| `allam-2-7b` | 400 — the prompt (~4.2k tokens) exceeds its context window |
| `groq/compound` | 429 — free-tier rate limit on its internal model (llama-4-scout) |
| `gemini-2.0-flash`, `gemini-2.5-flash` | No `GEMINI_API_KEY` |
| `deepseek-r1:free` | No `OPENROUTER_API_KEY` |

**Note on model catalogues:** four IDs that looked obvious
(`llama-3.3-70b-versatile`, `llama-3.1-8b-instant`, `qwen/qwen3-32b`,
`moonshotai/kimi-k2-instruct-0905`) **no longer exist on Groq**. The anecdotal
comparison recorded in `PROGRESS.md` is against a model that has been retired.
Always verify with `GET /v1/models` before adding an entry.

---

## Reproducing

```bash
npm run eval                                   # every model with a key present
npm run eval -- --models gpt-oss-120b          # just one
npm run eval -- --repeat 3                     # variance across identical runs
```

Keys: `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`. If `.env.local`'s
`OPENAI_COMPATIBLE_BASE_URL` matches a model's base URL, the harness reuses
`OPENAI_COMPATIBLE_API_KEY`. The `ollama-local` entry needs no key at all.

Locally served models:

```bash
OLLAMA_CONTEXT_LENGTH=16384 ollama serve                      # 4096 truncates the prompt
OLLAMA_MODEL=qwen2.5:7b npm run eval -- --models ollama-local
```

`OLLAMA_CONTEXT_LENGTH` is not optional. At the default the numbers describe a
truncated prompt, and nothing in the output says so.
