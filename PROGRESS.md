# Build state

Working document for resuming this build across sessions. Not part of the
deliverable — delete before submitting if you want a clean repo.

**Project**: AI Data Cleanup Assistant — One Day Build, Modern.tech (Senior Full Stack).
**Judged on**, in order: (1) it runs at a public URL with demo data in one click,
(2) the accept/reject review UX feels good, (3) decisions are defensible in the
README and video.

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
| A — Deployed skeleton | **Blocked** | Vercel project + Blob store done. Schema written but **not migrated** — needs Supabase credentials. Nothing deployed yet. |
| B — Contracts + fixtures | Done | `src/lib/contracts.ts`, `src/lib/fixtures.ts` |
| C — Review workspace | Done | `src/components/workspace/**`, works against fixtures at `/review` |
| D — Rules engine + LLM port | Done | `src/lib/profiling/**`, `src/lib/llm/**`. Real providers unverified (no key yet). |
| E — Ingest + chunked pipeline | **Written, unverified** | All routes exist and typecheck. Nothing has ever run against a real database. |
| F — Apply / export / audit | Not started | |
| G — Tests, CI, demo CSV, README | Partial | 119 tests green. No CI workflow, no `demo/messy-customers.csv` file, no README. |
| Video | Not started | |

**Tests**: 119 passing, 4 skipped (the skipped ones are the live-provider contract
tests, which run only when API keys are present).

---

## THE BLOCKER

The Supabase database password. Everything in phase E and beyond writes to Postgres
and has never executed.

Needed in `.env.local`:

```
DATABASE_URL=   # transaction pooler, port 6543 — used at runtime
DIRECT_URL=     # direct connection, port 5432 — used by drizzle-kit only
```

Project ref is `fapojysgmrjkfcycjyxt`. The Supabase MCP server is configured in
`.mcp.json` and can apply DDL, but it cannot supply a connection string to the
running app — that still needs the password.

Optional, to exercise the real model path:

```
ANTHROPIC_API_KEY=
```

Without it the pipeline falls back to `FakeLlm` and still completes end to end.

---

## Next steps, in order

1. Put `DATABASE_URL` / `DIRECT_URL` in `.env.local`.
2. `npm run db:push` to create the six tables.
3. `npm run dev`, click **Load demo data**, watch parse → profile → enrich → workspace.
4. Verify `/api/health` returns `{ ok: true, db: "connected" }`.
5. Phase F: `POST /api/datasets/[id]/apply` in a transaction writing `rows` + `audit`,
   then `GET .../export?format=csv|audit`.
6. Phase G: `.github/workflows/ci.yml`, `demo/messy-customers.csv`, README.
7. Push env vars to Vercel (`vercel env add`), deploy, verify in production.
8. Record the video.

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
