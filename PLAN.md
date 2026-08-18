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
this repo and building new ones from scratch. Budget $0 through week 5, then
~$50 of rented GPU.

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
| 2 | Running open weights yourself | new repo + this one | $0 | Not started |
| 3 | Harness: routing, proxy, observability | this repo + new repo | $0 | Not started |
| 4 | Real retrieval (embeddings, hybrid, reranking) | this repo + new repo | $0 | Not started |
| 5 | Agents: loops, tools, multi-agent | this repo + new repo | $0 | Not started |
| 6 | Real serving (vLLM) and fine-tuning (LoRA) | rented GPU | ~$50 | Not started |

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

**New repo — `local-inference-lab`**: Ollama as the quick entry point,
`llama.cpp` compiled by hand, MLX for comparison on Apple Silicon. Benchmark
script measuring tokens/s by quantisation and context size.

**Wire back**: `OPENAI_COMPATIBLE_BASE_URL=http://localhost:11434/v1` — the
adapter already supports it, and the week-1 harness already ships an
`ollama-local` entry.

**Deliverable**: a "local models" section in `EVALS.md` on the same metrics as
the cloud ones, so local and hosted sit in one comparable table.

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

**Build B — new repo, LiteLLM proxy**: one endpoint in front of Groq + Gemini +
Ollama; this repo points at it by changing one `BASE_URL`. Virtual keys, budgets,
retries, load balancing — and learning which problems belong to the code and
which to the proxy.

**Deliverable**: cost/quality before and after the router, visible in `/trace`.

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

**Build B — new repo, minimal RAG with no framework**: ingest → chunk → embed →
store → retrieve → rerank → generate, by hand. Then the same with a framework,
documenting what it saved and what it hid.

**Deliverable**: `RETRIEVAL.md` with recall@k for the three strategies, and their
effect on the rule-resolution rate (66% today).

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

**Build B — new repo, multi-agent stack**: planner/worker/critic roles.

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

## New repos this produces

| Repo | Week | What it demonstrates |
|---|---|---|
| `local-inference-lab` | 2 | Quantisation, tokens/s, llama.cpp/MLX |
| `llm-gateway` (LiteLLM) | 3 | Routing, budgets, infra-level fallbacks |
| `rag-from-scratch` | 4 | Retrieval without a framework, then with one |
| `agent-stack` | 5 | Multi-agent, roles, loops |

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
