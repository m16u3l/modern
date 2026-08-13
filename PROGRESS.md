# Build state

Working document for resuming this build across sessions. Not part of the
deliverable — delete before submitting if you want a clean repo.

**Project**: AI Data Cleanup Assistant — One Day Build, Modern.tech (Senior Full Stack).
**Judged on**, in order: (1) it runs at a public URL with demo data in one click,
(2) the accept/reject review UX feels good, (3) decisions are defensible in the
README and video.

### Where things live

| | |
|---|---|
| Repo | `m16u3l/modern` (public), branch `main` |
| Vercel project | `m16u3ls-projects/ai-data-cleanup` |
| Production URL | https://ai-data-cleanup-i8wnly34b-m16u3ls-projects.vercel.app |
| Supabase project ref | `fapojysgmrjkfcycjyxt` (MCP server configured in `.mcp.json`) |
| Blob store | `csv-uploads`, **private**, already linked to the project |
| Approved plan | `~/.claude/plans/quiero-hacer-esto-cryptic-stardust.md` (plan only, no progress) |

---

## Stack as built

Next.js 16.3 (App Router) · React 19.2 · TypeScript · Tailwind 4 · shadcn/ui (radix base, nova preset)
Supabase Postgres + Drizzle ORM + postgres-js · Vercel Blob (private store) · Vitest
Anthropic SDK 0.116 / OpenAI SDK 7.4 · Zod 4 · PapaParse

### Deviations from the original challenge document

| Point | Original | As built | Why |
|---|---|---|---|
| Database | MongoDB Atlas | Supabase Postgres + Drizzle | User's call. Supabase has no MySQL. Postgres also buys real transactions for apply+audit and SQL for the demo metrics. |
| LLM output | Tool use to force a schema | Structured outputs (`output_config.format` + `zodOutputFormat`) | The SDK supports it natively now. One Zod schema is both API contract and runtime validation, so the separate sanitisation layer disappears. |
| Second LLM | Anti-scope | In scope, built | User requires it to run on free models. |
| Blob access | (unspecified) | **Private** store | A CSV of someone's customers should not sit behind a guessable public URL. Costs one extra step: presigned URL to read server-side (`src/lib/blob.ts`). |

---

## Phase status

| Phase | State | Notes |
|---|---|---|
| A — Deployed skeleton | Done locally | Vercel project + Blob store done, deploy is Ready, six tables migrated, `/api/health` returns `db: "connected"`. Production still needs env vars — see blockers. |
| B — Contracts + fixtures | Done | `src/lib/contracts.ts`, `src/lib/fixtures.ts` |
| C — Review workspace | Done | `src/components/workspace/**`, works against fixtures at `/review` |
| D — Rules engine + LLM port | Done | `src/lib/profiling/**`, `src/lib/llm/**`. Real providers unverified (no key yet). |
| E — Ingest + chunked pipeline | **Verified locally** | Full run against Postgres: demo → blob → parse → profile → enrich → workspace. 53 issues, 35 by rules, 18 by the model. |
| F — Apply / export / audit | **Verified locally** | Applied 53 decisions: 31 cells rewritten, 8 rows deleted. Audit log cross-checked against the exported CSV — 0 mismatches. |
| G — Tests, CI, demo CSV, README | Done | CI workflow, `demo/messy-customers.csv` (generated from fixtures), full README with the trade-offs section. |
| Video | Not started | |

**Tests**: 132 passing, 4 skipped (the skipped ones are the live-provider contract
tests, which run only when API keys are present).

**Measured on the demo dataset**: 53 findings, 35 resolved by rules (66%), 18
escalated to the model. Regenerate with `profileDataset(FIXTURE_ROWS, headers)`.

---

## THE BLOCKERS

### 1. Vercel Deployment Protection is on

Every route on the production URL 302s to `vercel.com/sso-api`. An evaluator
opening the link sees a login screen, not the app — which fails the challenge's
first criterion outright.

Fix: Vercel → project `ai-data-cleanup` → Settings → Deployment Protection →
Vercel Authentication set to `Disabled`, or `Only Preview Deployments` (which
leaves production open and still protects previews). This is a change to the
user's project settings, so it needs their say-so.

### 2. Production has no database credentials

`.env.local` is set up and the six tables are migrated, so **everything works
locally**. Vercel does not have `DATABASE_URL` / `DIRECT_URL` yet, so the
deployed app cannot reach Postgres. See "Exact commands for step 5".

Not a blocker, but worth doing: `ANTHROPIC_API_KEY` is unset, so enrichment runs
on `FakeLlm`. The pipeline completes either way — that fallback is deliberate —
but the real adapter's structured outputs and prompt caching are still
unexercised against the live API.

---

## Next steps, in order

Local setup and the full pipeline are done and verified. What is left:

1. Push env vars to Vercel (see the commands below), then `vercel --prod`.
2. Turn off Deployment Protection and re-check every route returns 200.
3. Re-run the demo flow against the production URL, not just localhost.
4. Optional: set `ANTHROPIC_API_KEY` so enrichment exercises the real adapter
   instead of `FakeLlm`.
5. Record the 5-minute video. Practise the 3:00–4:15 architecture segment first.
6. Record a GIF for the README (there is a spot for it right under the title).

Optional if time allows: fill in the README's live URL if it changes, and delete
this file before submitting.

### Exact commands for step 5

```bash
vercel env add DATABASE_URL production        # paste the pooler string, port 6543
vercel env add DIRECT_URL production          # paste the direct string, port 5432
vercel env add LLM_PROVIDER production        # "anthropic", or "fake" to ship without a key
vercel env add ANTHROPIC_API_KEY production   # only if LLM_PROVIDER=anthropic
vercel --prod                                 # redeploy with the new env
```

`BLOB_READ_WRITE_TOKEN` is already set in Vercel by the blob store link — do not
add it by hand.

### Regenerating the demo CSV

`demo/messy-customers.csv` is generated, not hand-written. If the fixtures
change, regenerate so the two never drift:

```bash
npx tsx scripts/generate-demo-csv.mts
```

---

## Video plan (5 minutes, in English)

| Minute | Content |
|---|---|
| 0:00–0:30 | Who you are and what you built, in one sentence |
| 0:30–1:30 | Demo: load demo data → profiling with real progress → workspace |
| 1:30–3:00 | Review: grouping, diff, bulk accept, undo, export + audit |
| 3:00–4:15 | Architecture: the rules/LLM hybrid, "66% solved without AI", cost per run, chunking |
| 4:15–5:00 | Trade-offs, what you cut deliberately, what you'd do with a week |

Record 3:00–4:15 first and rehearse it — that is the segment that decides it.

## If time runs short

Cut in this order: cost panel → IQR outliers → fuzzy duplicates → LLM parser
tests → Sonnet escalation.

**Never cut**: the deploy, the demo data button, the grouping in the UI, the
README decisions section, the video.

---

## Architecture notes worth not rediscovering

- **Column statistics are computed once and passed into every chunk**
  (`computeColumnStats` in `src/lib/profiling/detectors.ts`). Recomputing them per
  chunk would let the same value be a format minority in one chunk and the majority
  in the next. There is a test asserting chunked and whole-dataset runs agree.
- **`ColumnStats` must stay JSON-serialisable** — it is persisted to `datasets.columns`
  as jsonb between invocations. It used `Map` initially; that broke chunking.
- **Cross-row detectors (duplicates) run in one final pass over all rows**, not over
  materialised keys. Fine at the 5k demo cap; it is the first thing that would move
  to a queued worker at 1M rows. This is the README's "what I'd do differently".
- **`prepare: false` is mandatory** with Supabase's transaction pooler (`src/db/index.ts`).
- **Never derive column order from `Object.keys(row.data)`.** Postgres does not
  preserve key order inside jsonb, so it comes back reordered and the exported CSV
  silently ships scrambled columns. The order is stored on `datasets.headers` at
  parse time and read from there. This one only showed up by running the export
  and eyeballing it — no type or test caught it.
- **`maxDuration` is exported per route file** — route handlers do not inherit it
  from a layout, so `vercel.json` alone would not work.
- **The rules engine imports nothing from Next, Drizzle or Anthropic.** Keep it that way;
  it is what makes the tests trivial and the "extract to a service" argument credible.

## Environment quirks on this machine

- `brew install gh` fails: Homebrew refuses to load formulae because third-party taps
  (`mongodb/brew`, `aws/tap`, `shivammathur/php`, `anomalyco/tap`) are untrusted.
  The `gh` binary was downloaded standalone instead; if the scratchpad is gone,
  download it again from the cli/cli releases rather than fighting brew.
- Chrome extension for browser automation is not connected, so UI verification has
  been by HTTP + component tests rather than screenshots.
