# rag — week 4

Retrieval by hand: ingest → chunk → embed → store → retrieve → rerank → generate,
with no framework. Then the same thing with one, documenting what it saved and
what it hid.

## Status

Not started.

## Why this pairs with the app

`detectFuzzyDuplicates` uses `similarity()` from `src/lib/profiling/values.ts` —
string distance. Fuzzy duplicates are also the category **every model measured so
far collapses on**: `gpt-oss-safeguard-20b` 0/6 in week 1, `qwen2.5:7b` 0/6 in
week 2. They are exactly the cases that escalate to a model today, so improving
retrieval there makes the whole pipeline cheaper.

The app-side build adds an embeddings route with pgvector on Supabase and compares
deterministic vs. embeddings vs. hybrid in the week-1 harness. This lab builds the
retrieval machinery from nothing so the comparison is understood rather than
imported.

## Deliverable

`RETRIEVAL.md` with recall@k, MRR and nDCG for the three strategies, and their
effect on the rule-resolution rate (66% today).
