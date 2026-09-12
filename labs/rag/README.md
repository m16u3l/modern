# rag — week 4

Retrieval by hand: ingest → chunk → embed → store → retrieve → rerank → generate,
with no framework. Then the same thing with one, documenting what it saved and
what it hid.

## Status

Done — the numbers are in [`RETRIEVAL.md`](../../RETRIEVAL.md):

- [x] Corpus and ground truth: 25 questions over this repo's own write-ups,
      labelled by section heading so one query set scores every chunking strategy
- [x] Two chunking strategies — section-aware and fixed windows
- [x] Three retrievers — dense (cosine), lexical (BM25, written out), hybrid (RRF)
- [x] recall@5, MRR, nDCG@5, and what a 25-query set can actually support
- [x] Two embedding models, 768 dims against 384 — and the truncation that made
      the first comparison between them meaningless
- [x] Reranking with a local generative model scoring each retrieved chunk

Not done:

- [ ] Generation. The pipeline stops at retrieval; no answer quality is claimed.
- [ ] The same thing with a framework, and what it saved.

## What it measures, briefly

| | Recall@5 | MRR |
|---|---|---|
| hybrid → rerank, section chunks | **84%** | 0.71 |
| hybrid, section chunks | 70% | 0.52 |
| dense, section chunks | 68% | 0.54 |
| dense, fixed windows | 52% | 0.35 |

Four findings, in descending order of how much they changed the conclusion:
**reranking** took 14 of the 16 points that were available to it, for 500 local
model calls; a **silent truncation** made the first embedding-model comparison
meaningless, and the real gap is 10 points rather than 2; the **labelling rule**
is worth 7-8 points of a fixed-window score and had to be fixed before any of
this meant anything; and **chunking is a dense-retrieval problem** — 16 points to
embeddings, nothing to BM25.

## Why this pairs with the app

`detectFuzzyDuplicates` uses `similarity()` from `src/lib/profiling/values.ts` —
string distance. Fuzzy duplicates are also the category models have the most
trouble with: `qwen2.5:7b` scored 0/6 on them in week 2, and
`gpt-oss-safeguard-20b` swings between 6/6 and 0/6 across runs (week 3, concept
31 — it is bimodal, not weak). They are the cases that escalate to a model today,
so a retriever that settles them earlier makes the whole pipeline cheaper.

The app-side build adds an embeddings route with pgvector on Supabase and
compares deterministic vs. embeddings vs. hybrid in the week-1 harness. **It is
blocked**: the Supabase project no longer exists. This lab builds the retrieval
machinery from nothing so that comparison is understood rather than imported, and
it needs no database.

## Running it

```bash
OLLAMA_CONTEXT_LENGTH=16384 ollama serve
ollama pull nomic-embed-text all-minilm qwen2.5:7b

npm run rag                              # the table, k = 5, seconds
npm run rag -- --k 3 --misses            # tighter window, and what it missed
npm run rag -- --ask "why ..."           # one question, three retrievers, what came back
npm run rag -- --rerank                  # adds the rerank pass — minutes, not seconds
npx vitest run labs/rag                  # chunkers, metrics, indexes, reranker
```

`--ask` is the one to start with by hand: the table says how often retrieval
works, and only the ranked list says whether a miss is the retriever's fault or
the question's.

Vectors and rerank scores are cached under `.cache/` keyed by (model, text), so a
second run costs nothing and the eval stays cheap enough to actually re-run. The
directory is gitignored; delete it to recompute.

## The corpus is frozen on purpose

`snapshot/` holds the copy of `LEARNING.md`, `EVALS.md` and `PLAN.md` that every
number is measured against. Reading the live files instead was the original
design and it was wrong: writing up a result adds concepts to `LEARNING.md`,
which edits the corpus the result was measured on. Two runs a day apart scored 74
chunks and then 97, and neither was reproducible afterwards.

Every run prints the fingerprint it used. `npm run rag:snapshot` refreshes the
copy — a deliberate act that makes the published table stale.

## Files

| | |
|---|---|
| `corpus.ts` | which documents are the corpus, and why they are frozen |
| `snapshot/` | the frozen copy every number is measured against |
| `chunk.ts` | section-aware and fixed-window splitting, and the coverage rule |
| `embed.ts` | Ollama `/api/embed` with an on-disk cache, `truncate: false` |
| `store.ts` | cosine over normalised vectors; BM25 with its idf written out |
| `retrieve.ts` | the three retrievers, and RRF |
| `rerank.ts` | pointwise reranking with a local model, and the tie-break |
| `metrics.ts` | recall@k, MRR, nDCG@k |
| `queries.ts` | the ground truth, and the two rules it was written under |
| `run.ts` | scores every combination, prints the markdown table |
