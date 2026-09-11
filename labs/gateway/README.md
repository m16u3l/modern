# gateway — week 3

A LiteLLM proxy in front of Groq + Ollama, so this repo points at one endpoint
and stops naming vendors.

## Status

Done. The numbers are in [`EVALS.md`](../../EVALS.md#through-the-proxy-with-prices-attached-labsgateway):
the app's router runs unchanged against the proxy's model names (94%, 17/18), and
the proxy's own cost map answered the question the free tier could not — a routed
batch costs **$0.001929** against **$0.002048** for one large model.

## Running it

```bash
cp .env.example .env    # GROQ_API_KEY, and a master key you invent
docker compose up -d
curl http://localhost:4000/v1/models -H "Authorization: Bearer $LITELLM_MASTER_KEY"
```

Then a virtual key for whoever is calling — scoped to these models, with a
budget, which is the part that needs the Postgres in the compose file:

```bash
curl http://localhost:4000/key/generate \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" -H "Content-Type: application/json" \
  -d '{"key_alias":"eval-harness","models":["reviewer-large","reviewer-small"],
       "max_budget":0.50,"budget_duration":"30d"}'
```

And the harness against it — the three `proxy-*` entries in `scripts/eval.mts`:

```bash
LITELLM_API_KEY=sk-... npm run eval -- --models proxy-router,proxy-large,proxy-any
```

## What the two builds taught, which was the point

Week 3 builds a router in the app **and** a proxy around it, to find out where
the line is. It turned out to be sharp:

| Belongs in `src/lib/llm/router.ts` | Belongs here |
|---|---|
| which model should see which issue type | retries, cooldowns, failover to another model |
| decisions justified by the eval table | virtual keys, budgets, spend logs |
| anything worth a unit test | anything worth changing without a deploy |

The evidence is the `reviewer-any` model group: one name, both models,
`latency-based-routing`. It scored **11/18** where the same models addressed
deliberately scored 17/18. **Load balancing distributes load and has no opinion
about quality** — ask it to make a quality decision and you get whichever answer
you happened to get.

The two layers also duplicate one job on purpose: the app's adapter retries
429/5xx (`withRetry` in `port.ts`) and so does `router_settings.num_retries`
here. The proxy's version can do something the app's cannot — fall over to a
*different model*, including the local one from week 2 — so the app's retry is
now the narrower of the two, and could reasonably be thinned once the proxy is
not optional.

## What is deliberately not here

- **Nothing in `src/` points at the proxy by default.** The deployed app talks to
  Groq directly; the proxy is a lab, and a lab that becomes a required
  dependency of the deploy stops being one.
- **The cost map is LiteLLM's, not an invoice.** The dollar figures are what the
  proxy believes Groq charges. They are exactly comparable to each other, which
  is what the comparison needed, and are not a bill.
