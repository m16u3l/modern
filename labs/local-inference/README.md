# local-inference — week 2

Running open weights on this machine (Apple M1 Pro, 16 GB unified memory) and
measuring what changes when the serving configuration changes.

## Status

The Ollama entry point is done and its number is already in
[`EVALS.md`](../../EVALS.md#local-models-week-2): `qwen2.5:7b` Q4_K_M at **11% on
4k context and 44% on 16k** — same weights, same machine, four times the accuracy
from one environment variable.

Remaining:

- [ ] `llama.cpp` compiled by hand, MLX for comparison on Apple Silicon
- [ ] benchmark script: tokens/s by quantisation and context size, prefill vs decode
- [ ] a second and third quantisation of the same model (`Q8_0`, FP16) side by side

## The trap this lab exists to document

Ollama sizes its default context from available VRAM and chose `num_ctx=4096`.
The eval prompt is ~4.7k tokens, so the server truncated it and answered anyway
with a normal 200:

```
msg="truncating input prompt" limit=2050 prompt=4731 keep=4 new=2050
```

Note `limit=2050`, not 4096 — half the window is reserved for the answer. **The
usable prompt is roughly half of `n_ctx`.**

Always start the server explicitly:

```bash
OLLAMA_CONTEXT_LENGTH=16384 ollama serve
```

## Wiring back to the harness

The `openai-compatible` adapter already speaks to Ollama, and the harness already
ships an `ollama-local` entry:

```bash
OLLAMA_MODEL=qwen2.5:7b npm run eval -- --models ollama-local
```

No key needed. If `.env.local` sets `OPENAI_COMPATIBLE_BASE_URL` to the Ollama
URL, the harness reuses `OPENAI_COMPATIBLE_API_KEY`.

## Concepts

Written up as concepts 20–25 in [`LEARNING.md`](../../LEARNING.md#week-2--open-weights-served-by-me):
context window as a serving parameter, silent prompt truncation, quantisation as
the wrong suspect, prefill vs decode, flat confidence, per-category collapse.
