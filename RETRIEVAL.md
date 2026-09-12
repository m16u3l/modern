# Retrieval evaluation

Week 4 of [`PLAN.md`](PLAN.md). Lexical search, dense embeddings, the two fused,
and a reranker over the result — scored on one query set, plus the three things
that turned out to matter more than the choice between them: how the corpus is
cut, how the ground truth is labelled, and whether the model can hold a chunk at
all.

All runs **2026-09-11**, local, `npm run rag`. Nothing here calls a hosted
provider.

## How it is scored

**Corpus**: this repo's own write-ups — `LEARNING.md`, `EVALS.md`, `PLAN.md`.
That is not a convenience. A retrieval eval needs to know which passage answers
which question, and these documents already carry it: every concept in
`LEARNING.md` is a titled section that answers one question and no other.

It is read from a **frozen copy** in `labs/rag/snapshot/`, and that copy is the
whole point. Reading the live files was the original design and it was wrong:
writing up a result adds concepts to `LEARNING.md`, which edits the corpus the
result was measured on. Two runs a day apart scored 74 chunks and then 97, and
neither was reproducible afterwards. Every run prints its fingerprint, and every
number below is from one run at:

```
corpus LEARNING.md, EVALS.md, PLAN.md @ 66ee4945, 77,764 chars, budget 1200
```

`npm run rag:snapshot` refreshes the copy — a deliberate act that makes this
table stale.

**Ground truth**: 25 questions in `labs/rag/queries.ts`, each labelled with the
section headings that answer it. Two rules, and they decide more than the
retriever does:

- **Questions are phrased as a person would ask them, not as the document says
  it.** Reusing a heading's own words hands BM25 the answer and turns the hybrid
  comparison into theatre.
- **Labels are headings, not chunk ids.** Chunk ids change with the chunking
  strategy; headings do not, which is what lets one query set score every
  strategy. `run.ts` refuses to run if a label names a heading the corpus does
  not contain, so a renamed section cannot quietly become an unanswerable query.

**Metrics**: recall@5 (is the answer in the window at all), MRR (how far down was
it), nDCG@5 (the same, but it keeps counting after the first hit). Embeddings and
rerank scores are cached on disk and nothing samples, so a repeat run is
identical — the uncertainty here is not run-to-run variance, it is 25 queries.

## Results

| Run | Chunks | Recall@5 | MRR | nDCG@5 | Time |
|---|---|---|---|---|---|
| **hybrid → rerank / section** | 100 | **84%** | **0.71** | **0.72** | 125s |
| vector → rerank / section | 100 | 79% | 0.65 | 0.66 | 335s |
| hybrid / section | 100 | 70% | 0.52 | 0.55 | 0.0s |
| vector / section | 100 | 68% | 0.54 | 0.56 | 0.0s |
| bm25 / section | 100 | 61% | 0.38 | 0.42 | 0.0s |
| vector / fixed | 79 | 52% | 0.35 | 0.37 | 0.0s |
| bm25 / fixed | 79 | 63% | 0.40 | 0.44 | 0.0s |
| hybrid / fixed | 79 | 65% | 0.49 | 0.50 | 0.0s |
| vector / section@500 | 261 | 68% | 0.41 | 0.47 | 0.0s |
| vector / section@500 / all-minilm | 261 | 58% | 0.32 | 0.38 | 0.0s |
| hybrid / section@500 / all-minilm | 261 | 66% | 0.50 | 0.52 | 0.0s |
| vector / section / prefixed | 100 | 60% | 0.42 | 0.44 | 0.0s |
| hybrid / section / prefixed | 100 | 72% | 0.48 | 0.53 | 0.0s |
| _vector / fixed-any_ | 79 | _59%_ | _0.45_ | _0.45_ | 0.0s |
| _bm25 / fixed-any_ | 79 | _71%_ | _0.48_ | _0.52_ | 0.0s |
| _hybrid / fixed-any_ | 79 | _73%_ | _0.59_ | _0.59_ | 0.0s |

Embedding model is `nomic-embed-text` unless the row says otherwise; `@500` is
the chunk budget in characters, 1200 when unstated; the reranker is
`qwen2.5:7b`. **The three italic rows are not results** — they are the same fixed
windows under a looser labelling rule, kept for the comparison below.

## Reranking is the largest win available, and it is not free

Retrieve ten, have a local 7B score each passage against the question, present
five:

| | Recall@5 | Ceiling (recall@10) | Headroom taken | MRR |
|---|---|---|---|---|
| vector | 68% → **79%** | 80% | **11 of 12** | 0.54 → 0.65 |
| hybrid | 70% → **84%** | 86% | **14 of 16** | 0.52 → 0.71 |

The ceiling column is what makes this readable. A reranker cannot find anything
retrieval missed — it only reorders a list that has already been fetched — so the
most it can ever do is drag everything sitting in positions 6 to 10 up into the
top 5. That headroom was 16 points for hybrid, and the reranker collected 14 of
them.

**Reported as "+14 points" this is the biggest number in the week. Reported as
"14 of the 16 available" it is closer to a finished mechanism**, and the second
framing is the one that says what to do next: no amount of reranker tuning gets
past 86%, so the next point has to come from retrieval or from chunking.

The cost is the entire problem. Those 25 questions took **125 seconds and 500
local model calls**, against ~0.05s for the retrieval it reorders — four orders
of magnitude for 14 points. It is behind `--rerank` for exactly that reason: a
default run has to stay fast enough to re-run while iterating.

Two implementation details that are not cosmetic:

- **Ties are the common case, not an edge case.** A 0-10 integer over ten
  candidates collides constantly — most passages score 2 or 3 — so the
  retriever's order is the tie-break. Without a stable tie-break the reranker
  shuffles everything it has no opinion about, and the shuffle reads as the
  reranker working.
- **An unparseable reply scores 0 rather than throwing.** A model told to answer
  with one integer does not always answer with one integer, and the run should
  report a worse reranker rather than stop.

This is **not** evidence about cross-encoders. A real reranker is trained to read
(query, passage) as one sequence; none runs locally here, so a generalist was
asked for a number instead. Different mechanism, different failure modes.

## The measurement that was measuring a truncation

An earlier version of this table scored `all-minilm` at 68% against
`nomic-embed-text`'s 70% and concluded that 45 MB buys what 274 MB buys. That was
an artefact, and the guard that caught it was one line: Ollama's `/api/embed`
truncates by default, so **an input longer than the model's context still returns
a vector** — a confident, complete, wrong vector. Setting `truncate: false`
turned the next run into a wall of 400s.

What the errors exposed, measured rather than assumed:

| | Context | Largest chunk it accepts from this corpus |
|---|---|---|
| `nomic-embed-text` | 2,048 tokens | ~16,000 chars |
| `all-minilm` | 512 tokens | **~500 chars** |

Five hundred characters per 512 tokens is about **one character per token** —
markdown tables, `|---|---|` rules and backticked identifiers tokenise close to
worst case. The small model could never hold a section chunk, so every
`all-minilm` number in that table was computed on text cut off mid-section.

It also exposed a bug in the chunker, which is the more embarrassing half: the
budget was never enforced. `splitParagraphs` refused to split a paragraph, a
markdown table *is* a single paragraph, so a budget of 600 still produced
933-character chunks — and the heading was prepended *after* the split, putting
every chunk over by the length of its title. Both fixed; the longest chunk now
equals the budget exactly.

**A chunk budget the chunker treats as advisory is not a budget, and the model
that has to embed it is what finds out.**

## The small model costs ten points, not two

With the budget dropped to 500 so `all-minilm` can hold a chunk uncut, and the
large model run over the *same* chunks so that the model and the budget are not
the same column:

| Model | Dims | Size | Chunks | Recall@5 | MRR |
|---|---|---|---|---|---|
| nomic-embed-text @ 1200 | 768 | 274 MB | 100 | 68% | 0.54 |
| nomic-embed-text @ 500 | 768 | 274 MB | 261 | 68% | 0.41 |
| all-minilm @ 500 | 384 | 45 MB | 261 | **58%** | 0.32 |

- **The budget is free for the large model.** 68% at either size; only MRR moves
  (0.54 → 0.41), because 261 small chunks crowd the top of the ranking with
  near-misses.
- **The model is worth 10 points at a fixed budget.** 68% vs 58% on identical
  chunks. The earlier "two points" was the truncation flattering the small model
  by hiding the text it could not read.

And the cost is larger than the table: choosing the 45 MB model does not only
lose 10 points, it **forces a 500-character budget on the whole corpus**, which
is a different retrieval system, not a cheaper one.

## The labelling rule is worth as much as the retriever

Fixed windows first scored **33%**. That was a fact about `run.ts`, not about
chunking: a window opening in the middle of concept 20 and carrying the whole of
concept 21 was labelled "20", because the first rule was *a window belongs to the
section it opens in*. Retrieving it for a question about 21 counted as a miss.

Crediting a window with any section it overlaps overshoots the other way — a
window clipping ten characters off a section is then credited with answering for
it. So the rule in the table is **a window covers a section when it carries at
least half of it**, and `fixed-any` is kept alongside to price the choice:

| Labelling rule | vector | bm25 | hybrid |
|---|---|---|---|
| covers ≥ 50% of the section | 52% | 63% | 65% |
| any overlap at all | 59% | 71% | 73% |

**Seven or eight points of a fixed-window score is the labelling rule.** Under
the loosest rule fixed windows beat every unreranked row in the table — the
strategy with the fuzziest unit of truth is the one a careless metric flatters
most.

Section chunking is immune: one chunk covers exactly one section by construction,
so there is no rule to choose and nothing to tune. That is a reason to prefer it
that has nothing to do with its score.

## Chunking is a dense-retrieval problem

| Chunking | vector | bm25 | hybrid |
|---|---|---|---|
| section | 68% | 61% | 70% |
| fixed | 52% | 63% | 65% |
| Δ | **−16** | +2 | −5 |

Cutting on structure was worth 16 points to embeddings and **nothing to BM25**,
which if anything preferred the windows. The asymmetry says what a chunk is *for*
in each method: BM25 matches terms, and a term is a term wherever it falls, so a
bad cut scatters the evidence but does not destroy it. An embedding is one vector
for the whole window, so a window straddling two concepts lands at a point close
to neither — the evidence is not scattered, it is averaged away.

The practical form: if retrieval is lexical, spend the effort on the query; if it
is dense, spend it on the cut. Advice about chunking that does not say which one
it is talking about is not advice.

It also means hybrid is **insurance against bad chunks, not an upgrade over good
ones**: +13 points over dense on fixed windows, +2 on section chunks.

## What 25 queries can and cannot say

One query is four points of recall. So:

- **Supported**: reranking (+14, and 14 of 16 available). The model gap at a
  fixed budget (10). Section chunking over fixed windows for dense retrieval
  (16). Hybrid rescuing fixed windows (13). The labelling rule (7-8).
- **Not supported**: hybrid vs dense on section chunks (2). The chunk budget for
  the large model (0).
- **Unstable, and reported as such**: the instruction prefixes
  `nomic-embed-text` is trained with (`search_document:` / `search_query:`).
  Dense retrieval loses 8 points with them, hybrid gains 2, and Ollama's API docs
  do not mention them at all. This query set cannot settle it.

There is now direct evidence for that resolution, and it is worth more than the
arithmetic: **adding two concepts to `LEARNING.md` moved several rows by 2 to 4
points** — `hybrid / fixed` fell from 69% to 65%, `hybrid / section / prefixed`
from 76% to 72% — purely from three more chunks entering the corpus. Every gap
listed as "not supported" is smaller than the noise that a routine edit
introduces. The corpus freeze stops that from happening silently again; it does
not make a 2-point gap real.

The next thing this lab needs is **more queries, not another retriever**.

## Not measured yet

- **Generation.** The pipeline stops at retrieval and reranking. Nothing answers
  a question yet, so no answer quality is claimed.
- **The same thing with a framework**, and what it saved or hid.
- **The app half.** `detectFuzzyDuplicates` still uses string distance. The
  pgvector comparison in `PLAN.md` needs a Supabase project, which no longer
  exists — see `PROGRESS.md`.

## Reproducing

```bash
OLLAMA_CONTEXT_LENGTH=16384 ollama serve
ollama pull nomic-embed-text all-minilm qwen2.5:7b

npm run rag                          # the table minus the rerank rows, seconds
npm run rag -- --rerank              # adds them, ~8 minutes cold
npm run rag -- --k 3 --misses        # tighter window, and what it missed
npm run rag -- --ask "why ..."       # one question, three retrievers, what came back
npx vitest run labs/rag              # chunkers, metrics, indexes, reranker
```

Vectors and rerank scores are cached under `labs/rag/.cache` keyed by (model,
text), so a second run costs nothing and an edited document misses the cache
rather than reusing a stale vector. Delete the directory to recompute.
