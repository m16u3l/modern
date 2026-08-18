# Model evaluation

Produced by `npm run eval`. Every model receives **exactly the same 18 ambiguous
candidates** — the ones the rules engine cannot resolve on its own — and is
scored against the known-correct answers in `src/lib/fixtures.ts`.

Last run: **2026-08-18**. Provider: Groq (free tier).
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

## Models that could not be measured

| Model | Reason |
|---|---|
| `qwen/qwen3.6-27b` | 400 — cannot produce valid JSON for the schema, nor on the fallback path |
| `allam-2-7b` | 400 — the prompt (~4.2k tokens) exceeds its context window |
| `groq/compound` | 429 — free-tier rate limit on its internal model (llama-4-scout) |
| `gemini-2.0-flash`, `gemini-2.5-flash` | No `GEMINI_API_KEY` |
| `deepseek-r1:free` | No `OPENROUTER_API_KEY` |
| `ollama-local` | Ollama not running (week 2) |

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
`OPENAI_COMPATIBLE_API_KEY`.
