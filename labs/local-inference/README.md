# local-inference — week 2

Running open weights on this machine (Apple M1 Pro, 16 GB unified memory) and
measuring what changes when the serving configuration changes.

Every number below is in [`EVALS.md`](../../EVALS.md#local-models-week-2); this
file is how to reproduce them.

## Status

Done:

- [x] Ollama entry point — `qwen2.5:7b` Q4_K_M at **11% on a 4k window and 44% on
      16k**, same weights, four times the accuracy from one environment variable
- [x] `bench.py` — prefill and decode tok/s by quantisation and context size
- [x] `llama.cpp` compiled by hand, and used to check the numbers Ollama reports
- [x] Q8_0 alongside Q4_K_M: **39% vs 44%** — twice the bits, no accuracy
- [x] MLX vs llama.cpp — at 0.5B, not 7B, and not on identical weights; see below

Not done, and why:

- **FP16 as a third quantisation.** 7.62 B parameters × 2 bytes is ~15.2 GB of
  weights; Metal offers 11.3 GiB on this machine. Ruled out by arithmetic rather
  than measured — see concept 28.
- **MLX at 7B.** Hugging Face's CDN served this machine at ~300 KB/s on
  2026-09-08 — four hours for the 4.3 GB of `Qwen2.5-7B-Instruct-4bit`, against
  8 MB/s from Ollama's registry for the same weights in GGUF. The MLX comparison
  was done at 0.5B instead, where both runtimes hold identical weights and the
  download is minutes. **A 0.5B result does not transfer to 7B**: at that size
  the per-token overheads of the runtime dominate rather than memory bandwidth,
  which is the regime that matters on a 7B model.

## bench.py

Prefill and decode are different regimes (concept 23) and this measures them
apart, against three backends, with no dependencies beyond the system Python:

```bash
python3 bench.py --model qwen2.5:7b,qwen2.5:7b-instruct-q8_0 \
                 --ctx 4096,8192,16384 --prompt-tokens 4700 --predict 128 --repeat 3
python3 bench.py --backend llamacpp --model q4 --ctx 16384   # llama-server on :8080
python3 bench.py --backend openai --host http://127.0.0.1:1234 --model ... # LM Studio, MLX
```

It prints a markdown table and writes the raw runs to `results/` (gitignored).
Two decisions worth knowing about:

- **Every run gets a unique prefix.** Without it the servers' prefix cache
  answers from the second repetition onward and the script reports ~26,000 tok/s
  of prefill. `--reuse-cache` reproduces that wrong number deliberately.
- **Client and server timings are both printed.** They agree within ~1% on
  Ollama and llama.cpp, which is what makes a disagreement elsewhere meaningful.

## The trap this lab exists to document

Ollama sizes its default context from available VRAM and chose `num_ctx=4096`.
The eval prompt is ~4.7k tokens, so the server truncated it and answered anyway
with a normal 200:

```
msg="truncating input prompt" limit=2050 prompt=4731 keep=4 new=2050
```

**Correction to the first version of this file**, which read the `limit=2050` as
"the usable prompt is half of `n_ctx`". The measurements say otherwise: at
`num_ctx=8192` the same 4,725-token prompt passes whole, and 4,725 is well past
half of 8,192. The rule that fits both: truncation happens only when the prompt
exceeds the **whole** window, and then it drops to about half of it.

Always start the server explicitly:

```bash
OLLAMA_CONTEXT_LENGTH=16384 ollama serve
```

## Building llama.cpp here

Homebrew refuses to install anything on this machine (untrusted taps), so cmake
came from the Kitware release tarball, unpacked into `~/.local/opt/cmake`:

```bash
git clone --depth 1 https://github.com/ggml-org/llama.cpp ~/.local/src/llama.cpp
cmake -B build -DCMAKE_BUILD_TYPE=Release -DGGML_METAL=ON \
      -DGGML_METAL_EMBED_LIBRARY=ON -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF
cmake --build build --config Release -j 8
```

`GGML_METAL_EMBED_LIBRARY=ON` puts the Metal shaders inside the binary, so the
tools run from any directory without hunting for `ggml-metal.metal`.

That gives `llama-bench`, the project's own benchmark, which reads Ollama's blobs
directly — they are plain GGUF files under `~/.ollama/models/blobs`, addressed by
digest:

```bash
llama-bench -m ~/.ollama/models/blobs/sha256-2bada8a745... -p 4700 -n 128 -r 3
```

Its numbers are how `bench.py` was checked, and how the 13% Ollama overhead was
established as real rather than an artefact of my script.

## MLX

```bash
python3 -m venv .venv && .venv/bin/pip install mlx-lm
.venv/bin/mlx_lm.generate --model mlx-community/Qwen2.5-7B-Instruct-4bit \
    --prompt - --max-tokens 128 --temp 0 --ignore-chat-template < prompt.txt
```

`mlx_lm.generate` reports prompt tok/s, generation tok/s and peak memory, so it
is the MLX equivalent of `llama-bench`. **Discard the first run**: MLX compiles
its Metal kernels on first use and reported 1,524 tok/s of prefill before
settling at ~4,030 on the next three.

At 0.5B it beat llama.cpp by 26% on prefill and 19% on decode — with the caveat
that the MLX build is 265 MB against the GGUF's 374 MB for the same 494 M
parameters, so the two are not the same weights and this does not isolate the
runtime from the quantisation scheme.

## Wiring back to the harness

The `openai-compatible` adapter already speaks to Ollama, and the harness already
ships an `ollama-local` entry:

```bash
OLLAMA_MODEL=qwen2.5:7b npm run eval -- --models ollama-local
OLLAMA_MODEL=qwen2.5:7b-instruct-q8_0 npm run eval -- --models ollama-local
```

No key needed. If `.env.local` sets `OPENAI_COMPATIBLE_BASE_URL` to the Ollama
URL, the harness reuses `OPENAI_COMPATIBLE_API_KEY`.

## Concepts

Concepts 20–29 in [`LEARNING.md`](../../LEARNING.md): context window as a serving
parameter, silent prompt truncation, quantisation as the wrong suspect, prefill
vs decode, flat confidence, per-category collapse, the prefix cache, what more
bits buy, the memory arithmetic of serving, and the cost of the serving stack.
