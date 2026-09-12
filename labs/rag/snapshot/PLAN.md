# Personal AI Engineering curriculum — 6 weeks, with this repo as the test bench

> **Feedback welcome.** This is a self-directed learning plan, written to be
> criticised. The two questions I most want answered: **is the ordering
> sensible, and is anything important missing?** Open an issue or mark it up.

## Context

I am a software engineer with full stack experience, and I want to close the gap
between *using* AI (calling an API and integrating it) and *understanding* AI as
infrastructure.

Honest self-assessment of the starting point:

| I can do | I cannot do yet |
|---|---|
| Integrate a managed provider (Bedrock, SDKs) | Serve a model myself |
| Pick a model on intuition | Measure models and defend the choice with numbers |
| Call an LLM and parse its output | Routing, caching, budgets, model observability |
| Say "we use RAG" | Explain chunking, ranking, hybrid search, recall@k |
| A one-shot pipeline | Agentic loops, tools, multiple roles |
| Consume closed weights | Run open weights, quantisation, fine-tuning |

**Why this repo is the bench.** It already has the piece that makes measurement
possible: `LlmPort` (`src/lib/llm/port.ts`) with three interchangeable adapters,
batching, token accounting (`TokenUsage` → the `llm_usage` table), controlled
degradation (`reviewWithFallback`), and a `/trace` page reading straight from the
tables. It also has **ground truth** — `src/lib/fixtures.ts` carries the
known-correct answer for every issue in the demo dataset, which turns the repo
into an evaluation bench without fabricating a test set.

**Parameters**: ~20h/week over 6 weeks (~120h). Roughly 50/50 between extending
the app and building from scratch in [`labs/`](labs/). Budget $0 through week 5,
then ~$50 of rented GPU.

**Study rule**: every concept that appears while building goes into
[`LEARNING.md`](LEARNING.md) — what it is, why it matters, where I saw it — in
the moment, not afterwards.

---

## Structure

Each week: **concept → build → measure → written deliverable**. The rule that
keeps this from being another tutorial: *nothing counts as learned until it
produces a number in week 1's eval harness.*

| Wk | Topic | Where | Cost | Status |
|---|---|---|---|---|
| 1 | Evals and the model landscape | this repo | $0 | **Done** — [`EVALS.md`](EVALS.md) |
| 2 | Running open weights yourself | app + [`labs/local-inference`](labs/local-inference/) | $0 | **Done** — quantisation, throughput and serving-stack numbers in [`EVALS.md`](EVALS.md) |
| 3 | Harness: routing, proxy, observability | app + [`labs/gateway`](labs/gateway/) | $0 | **Done** — the router ties on score and wins on variance; see [`EVALS.md`](EVALS.md#routing-week-3) |
| 4 | Real retrieval (embeddings, hybrid, reranking) | app + [`labs/rag`](labs/rag/) | $0 | **Lab done** — [`RETRIEVAL.md`](RETRIEVAL.md); app half blocked, no database |
| 5 | Agents: loops, tools, multi-agent | app + [`labs/agents`](labs/agents/) | $0 | Not started |
| 6 | Real serving (vLLM) and fine-tuning (LoRA) | [`labs/serving`](labs/serving/), rented GPU | ~$50 | Not started |

**One repo, not five.** Every week has an *app* half — code that ships inside the
CSV tool — and a *lab* half built from scratch to understand what the app half is
using. The labs were originally going to be separate repos; they live in
[`labs/`](labs/) instead, because two copies of the ground truth in
`src/lib/fixtures.ts` would make the tables in `EVALS.md` incomparable, and a
comparable table is the only thing this plan promises. They are excluded from the
Next build, from `tsconfig.json` and from lint, so a lab cannot break the deploy.

---

## Week 1 — Evals: stop having opinions about models, start measuring them

**Concept**: what an eval is and why it is the base skill. Ground truth, accuracy
per category, latency, tokens in/out, cost per million, answer coverage,
confidence calibration.

**Built**: `scripts/eval.mts` (`npm run eval`). Takes the 18 ambiguous candidates
the rules engine cannot resolve, runs N models over them through `LlmPort`, and
scores against `FIXTURE_SUGGESTIONS`. Ground truth matched on `(column, row)`;
coverage 18/18.

**Result**: [`EVALS.md`](EVALS.md). Headline — `gpt-oss-120b` at 94%,
`gpt-oss-20b` at 28%, against a deterministic stub baseline at 56%. A smaller
model from the same family is worse than calling no model at all.

Two things the eval found that no manual run would have: a **bug in this repo's
own adapter** (the `json_schema` fallback appended a trailing `system` message,
which Groq's `compound` models reject with a 400 — fixing it took `compound-mini`
from total failure to 17/18), and a **design flaw in my first metric** (requiring
the exact action label scored the best model at 61% when its real repair accuracy
was 94%).

---

## Week 2 — Open weights, running on my own machine

**Concept**: what a weight is. Quantisation (GGUF `Q4_K_M` vs `Q8_0` vs FP16),
context window and KV cache, prefill vs decode tokens/s, RAM/VRAM requirements,
why a quantised 7B can beat a badly served 70B.

**Lab — [`labs/local-inference`](labs/local-inference/)**: Ollama as the quick
entry point, `llama.cpp` compiled by hand, MLX for comparison on Apple Silicon.
Benchmark script measuring tokens/s by quantisation and context size.

**Wire back**: `OPENAI_COMPATIBLE_BASE_URL=http://localhost:11434/v1` — the
adapter already supports it, and the week-1 harness already ships an
`ollama-local` entry.

**Deliverable**: a "local models" section in `EVALS.md` on the same metrics as
the cloud ones, so local and hosted sit in one comparable table.

**Result**: [`EVALS.md`](EVALS.md#local-models-week-2), and `bench.py` in the lab
for the throughput half. Headlines — the context window was worth **33 accuracy
points** (11% → 44%) and the quantisation was worth **none** (Q8_0 at 39% against
Q4_K_M's 44%, one candidate apart on 18, for 1.7× the memory). The
`fuzzy_duplicate` collapse to 0/6 survives at 8 bits, so it is the model's
judgment and not a rounding artefact. Serving the same GGUF through Ollama rather
than llama.cpp costs 13% of prefill; flash attention is worth 4%; the context
window costs RAM and not speed.

Two measurements that were wrong before they were right, both found by a number
being implausible rather than by reading code: a first benchmark reporting 26,000
tok/s of prefill because the servers' prefix cache was answering every repetition,
and MLX's first run at a third of its later speed because it compiles Metal
kernels on first use.

Two things this week did **not** produce, and why: FP16 does not fit (~15.2 GB of
weights against Metal's 11.3 GiB here), and the MLX comparison was made at 0.5B
rather than 7B because Hugging Face's CDN was serving this machine at ~300 KB/s.
The 0.5B numbers do not transfer — Ollama's overhead against llama.cpp inverts
between the two sizes.

---

## Week 3 — Harness engineering

**Concept**: the harness is everything around the model — routing, caching,
retries, fallbacks, budgets, traceability. Fallback and accounting exist here
already; routing and a proxy do not.

**Build A — `src/lib/llm/router.ts`**: implements `LlmPort`, so it should pass
`src/lib/llm/port.test.ts` **without touching the test**. Dispatches on issue type
using week 1's accuracy-by-type table. That table already suggests the shape:
`gpt-oss-safeguard-20b` matches the 120B on `missing_value`, `type_mismatch` and
`suspicious_value` at half the latency, and only collapses on `fuzzy_duplicate` —
so 12 of 18 cases could go to the cheap model.

**Build B — [`labs/gateway`](labs/gateway/), LiteLLM proxy**: one endpoint in
front of Groq + Gemini + Ollama; the app points at it by changing one `BASE_URL`.
Virtual keys, budgets, retries, load balancing — and learning which problems
belong to the code and which to the proxy.

**Deliverable**: cost/quality before and after the router, visible in `/trace`.

**Result**: [`EVALS.md`](EVALS.md#routing-week-3). `src/lib/llm/router.ts` is an
`LlmPort` that groups a batch by issue type and dispatches each group, so it
passes the existing contract test without the contract being told it exists.
`/trace` shows the split because the enrich route now writes one `llm_usage` row
per model that answered, rather than one total attributed to the routing table.

The headline is **a tie, not a win**: 94% for the router, 94% for
`gpt-oss-120b` alone. What repeating the runs found instead is that
`gpt-oss-safeguard-20b` is **bimodal** on `fuzzy_duplicate` — 6/6 in one run,
0/6 in two others, at `temperature: 0` — so week 1's "0/6, a per-category
weakness", the very premise this router was designed from, was one side of a coin
flip recorded as a property. The router scored 17/18 in all three of its runs and
is the only configuration here that did. **Routing bought variance, not accuracy.**

It also bought 6% of cost ($0.001929 vs $0.002048 per batch, priced by the proxy)
— thin, because splitting a batch sends the shared column context to both models
and that is +1,703 input tokens before any verdict exists.

[`labs/gateway`](labs/gateway/) settled the other question. The proxy's
`reviewer-any` group — one name, both models, latency-based load balancing —
scored **11/18** against 17/18 for the same models addressed deliberately, which
is the line between the two builds: quality dispatch belongs in the app, and
everything about getting the call through belongs in the proxy.

---

## Week 4 — Real retrieval

**Concept**: embeddings and cosine similarity, chunking strategies, hybrid search
(BM25 + vector), cross-encoder reranking, and the metrics that go with them:
recall@k, MRR, nDCG.

**Build A here**: `detectFuzzyDuplicates` currently uses `similarity()` from
`src/lib/profiling/values.ts`, which is string distance. Add an embeddings route
with **pgvector** on Supabase and compare all three — deterministic vs.
embeddings vs. hybrid — in the week-1 harness. Fuzzy duplicates are exactly the
cases that escalate to a model today, so improving there makes the whole pipeline
cheaper.

**Build B — [`labs/rag`](labs/rag/), minimal RAG with no framework**: ingest →
chunk → embed → store → retrieve → rerank → generate, by hand. Then the same with
a framework, documenting what it saved and what it hid.

**Deliverable**: `RETRIEVAL.md` with recall@k for the three strategies, and their
effect on the rule-resolution rate (66% today).

**Result so far**: [`RETRIEVAL.md`](RETRIEVAL.md). Build B is done to the end of
retrieval — 25 questions over this repo's own write-ups, labelled by section
heading so one query set scores every chunking strategy, with BM25 and RRF
written out rather than imported. Dense retrieval over section chunks leads at
**70% recall@5**.

The headline is not which retriever won. It is that **the first comparison
measured the labelling rule instead of the retrieval**: fixed windows scored 33%
because a window was credited only with the section it opened in, and 55-59%
once that was fixed — so 4 to 8 points of a fixed-window score belongs to
bookkeeping. The finding underneath it is that **chunking is a dense-retrieval
problem** (15 points to embeddings, 3 to BM25, which is indifferent to where a
term falls), and that hybrid search is insurance against bad chunks rather than
an upgrade over good ones: +12 points on fixed windows, 0 on section chunks,
where it also cost MRR.

Three comparisons came back inside the noise of a 25-query set and are reported
as ties rather than dressed up: hybrid vs dense on good chunks, a 45 MB
embedding model vs a 274 MB one, and the instruction prefixes `nomic-embed-text`
was trained with. What the lab needs next is more queries, not another retriever.

**Blocked**: Build A needs pgvector, and the Supabase project no longer exists
(`PROGRESS.md`, 2026-08-28). Reranking and generation are still open in the lab.

---

## Week 5 — Agents: turning the one-shot pipeline into a loop

**Concept**: tool calling vs. one-shot structured output, the ReAct loop, critic
agents, orchestration by role, termination criteria, step budgets, and why
evaluating agents is harder than evaluating models.

**Build A here**: `src/app/api/datasets/[id]/enrich/route.ts` makes **one** call
today. Turn it into a loop — a critic reviewing verdicts under
`LOW_CONFIDENCE_THRESHOLD` (0.7), retry with a larger model through week 3's
router, and tool calling so the model can request more rows instead of only
receiving the ones handed to it. The `maxDuration = 60` ceiling on the route
forces rethinking the chunking.

**Build B — [`labs/agents`](labs/agents/), multi-agent stack**:
planner/worker/critic roles.

**Deliverable**: one-shot vs. loop measured in the same harness. Does accuracy go
up, and how much more does it cost?

---

## Week 6 — Real serving and fine-tuning

**Concept**: vLLM and PagedAttention, continuous batching, throughput vs.
latency, concurrency; LoRA/QLoRA, dataset construction, and the honest question
of when fine-tuning beats a good prompt.

**Build**: rented GPU (~$0.40/h, 20-40h within budget). vLLM serving an open
model, throughput benchmarked at increasing concurrency against week 2's local
numbers. Then a **small LoRA** — and the training data already exists: the
`suggestions` and `audit` tables store every proposed verdict, its rationale, and
what a human decided. That is real human preference over this domain.

Since vLLM exposes an OpenAI-compatible API, the fine-tuned model drops in by
changing one `BASE_URL` and gets scored by the week-1 harness.

**Deliverable**: a final row in `EVALS.md` — my own model, measured against the
hosted ones, with cost per million tokens computed from the GPU price.

---

## What [`labs/`](labs/) produces

| Lab | Week | What it demonstrates |
|---|---|---|
| [`local-inference`](labs/local-inference/) | 2 | Quantisation, tokens/s, llama.cpp/MLX |
| [`gateway`](labs/gateway/) | 3 | Routing, budgets, infra-level fallbacks (LiteLLM) |
| [`rag`](labs/rag/) | 4 | Retrieval without a framework, then with one |
| [`agents`](labs/agents/) | 5 | Multi-agent, roles, loops |
| [`serving`](labs/serving/) | 6 | vLLM throughput, LoRA fine-tuning |

Each one is finished when its result is a row in `EVALS.md` (or `RETRIEVAL.md`
for week 4) and its concepts are in `LEARNING.md` — not when its code runs.

---

## Constraints shaping the plan

- **Free tiers first.** No paid API budget until week 6, which is why the model
  list is Groq / Gemini / OpenRouter free tiers and local Ollama. The Anthropic
  key this repo shipped with authenticates but has no credit.
- **Free-tier rate limits** are the main source of inconsistent eval runs. The
  adapter retries 429/5xx with exponential backoff and the harness spaces its
  calls.
- **`maxDuration = 60`** on the Vercel routes limits how much agent loop fits in
  one invocation (week 5).

---

## How I will know it worked

Not by weeks completed, but by being able to answer these with a number of my
own:

1. Which model would you use for this task, and why? → `EVALS.md`
2. How did you do the retrieval? → `RETRIEVAL.md`, with recall@k
3. Have you run a model yourself? → quantisation benchmarks, weeks 2 and 6
4. How do you make a system cheaper without losing quality? → the router, week 3
5. Have you built anything agentic? → the critic loop, week 5
