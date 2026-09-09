# gateway — week 3

A LiteLLM proxy in front of Groq + Gemini + Ollama, so this repo points at one
endpoint by changing a single `BASE_URL`.

## Status

Not started.

## What it is for

Week 3 has two builds, and the split is the lesson. `src/lib/llm/router.ts` in the
app answers *which model should see this issue type* — application logic, keyed on
week 1's accuracy-by-type table. This lab answers *what happens around the call*:
virtual keys, budgets, retries, load balancing.

The point of doing both is to learn **which problems belong to the code and which
to the proxy**, rather than assuming.

## Wiring back to the harness

The proxy exposes an OpenAI-compatible API, so it needs no adapter work:

```bash
OPENAI_COMPATIBLE_BASE_URL=http://localhost:4000 npm run eval
```

## Deliverable

Cost and quality before and after the router, visible in `/trace`.
