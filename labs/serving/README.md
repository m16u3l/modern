# serving — week 6

vLLM on a rented GPU (~$0.40/h, the only paid week), and a small LoRA.

## Status

Not started. Budget ~$50.

## Two builds

**Throughput.** vLLM serving an open model, benchmarked at increasing concurrency
against week 2's single-stream laptop numbers. PagedAttention and continuous
batching are the concepts; the number is tokens/s as concurrency rises, and where
latency starts paying for it.

**LoRA.** The training data already exists in this app: the `suggestions` and
`audit` tables store every proposed verdict, its rationale, and what a human
decided. That is real human preference over this domain, not a synthetic set.

## Wiring back to the harness

vLLM exposes an OpenAI-compatible API, so the fine-tuned model drops in the same
way every other model has:

```bash
OPENAI_COMPATIBLE_BASE_URL=http://<gpu-host>:8000/v1 npm run eval
```

## Deliverable

The final row of [`EVALS.md`](../../EVALS.md) — my own model, on the same 18
candidates as everything else, with cost per million tokens computed from the GPU
price.
