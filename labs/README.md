# labs

The build-from-scratch half of [`PLAN.md`](../PLAN.md). Each lab is a standalone
exercise that answers to the same harness as the app: whatever it produces gets
scored by `npm run eval` against the ground truth in `src/lib/fixtures.ts`, and
lands as a row in [`EVALS.md`](../EVALS.md).

They live here rather than in separate repos for one reason: **two copies of the
ground truth would make the tables incomparable**, and a comparable table is the
only thing the plan promises.

| Lab | Week | What it demonstrates | Language |
|---|---|---|---|
| [`local-inference`](local-inference/) | 2 | Quantisation, tokens/s, llama.cpp and MLX | shell + Python |
| [`gateway`](gateway/) | 3 | Routing, budgets, infra-level fallbacks (LiteLLM) | Python + compose |
| [`rag`](rag/) | 4 | Retrieval without a framework, then with one | TypeScript |
| [`agents`](agents/) | 5 | Multi-agent, roles, loops | TypeScript |
| [`serving`](serving/) | 6 | vLLM throughput, LoRA fine-tuning | Python, remote GPU |

## Rules

- **Excluded from the app's toolchain.** `tsconfig.json`, `eslint.config.mjs` and
  `.vercelignore` all skip `labs/`. A lab cannot break the deploy, and the Next
  build never sees this directory.
- **Each lab brings its own build.** No workspace protocol. A TypeScript lab gets
  its own `tsconfig.json`; a Python one gets its own venv. The exception is
  tests: `vitest.config.mts` picks up `labs/**/*.test.ts`, because a lab test
  cannot break the deploy and one vitest install is enough.
- **Nothing here is imported by `src/`.** The dependency runs one way — a lab may
  read from the app (the port, the fixtures), never the reverse.
- **The deliverable is a number, not the code.** A lab is finished when its result
  is in `EVALS.md` (or `RETRIEVAL.md` for week 4) and its concepts are in
  `LEARNING.md`.
