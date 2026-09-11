#!/usr/bin/env python3
"""Prefill and decode throughput for a locally served model.

Answers the two questions week 2 of ../../PLAN.md asks about serving:
how fast are the two phases, and what does the serving configuration
(quantisation, context window) do to them.

    python3 bench.py --backend ollama --model qwen2.5:7b --ctx 4096,16384

Every number is measured twice: once from the client's own clock, once from
whatever the server reports about itself. They are printed side by side
because a disagreement between them is a finding, not a rounding error.

Backends:
    ollama    POST /api/generate            (native, reports its own counters)
    llamacpp  POST /completion              (llama-server, reports timings)
    openai    POST /v1/completions          (MLX, LM Studio; falls back to chat)

No dependencies: stdlib only, so it runs against the system Python.
"""

import argparse
import json
import os
import uuid
import statistics
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

# A paragraph with no repetition inside it, so the tokenizer cannot collapse
# it; the prompt is this text repeated until it reaches the target length.
FILLER = (
    "The quarterly ledger for the Souther district lists forty-one entries, of "
    "which eleven arrived without a currency symbol and three carry a date in "
    "a format the parser rejects. Reconciliation is blocked until an operator "
    "decides whether the blank cells mean zero or mean unknown. "
)

NS = 1_000_000_000


def http_stream(url, payload, headers=None, timeout=600):
    """POST json, yield each line of the streamed response as text."""
    body = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        for raw in resp:
            line = raw.decode().strip()
            if line:
                yield line


def http_json(url, timeout=30):
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


# ---------------------------------------------------------------------------
# Backends
#
# Each returns the same record: what the client timed, and what the server said
# about itself. `prompt_tokens` is the count the server actually processed --
# which is the whole point of measuring it, since a server that truncates the
# prompt reports the truncated number and returns 200.
# ---------------------------------------------------------------------------


def run_ollama(host, model, prompt, num_ctx, predict):
    url = f"{host}/api/generate"
    payload = {
        "model": model,
        "prompt": prompt,
        "raw": True,  # no chat template, so prompt tokens are ours alone
        "stream": True,
        "options": {
            "num_ctx": num_ctx,
            "num_predict": predict,
            "temperature": 0,
            "seed": 7,
        },
    }
    t0 = time.perf_counter()
    t_first = None
    final = {}
    for line in http_stream(url, payload):
        chunk = json.loads(line)
        if t_first is None and chunk.get("response"):
            t_first = time.perf_counter()
        if chunk.get("done"):
            final = chunk
    t_end = time.perf_counter()
    return {
        "client_ttft_s": (t_first or t_end) - t0,
        "client_total_s": t_end - t0,
        "client_decode_tps": decode_tps(final.get("eval_count"), t_first, t_end),
        "prompt_tokens": final.get("prompt_eval_count"),
        "output_tokens": final.get("eval_count"),
        "server_prefill_tps": rate(final.get("prompt_eval_count"), final.get("prompt_eval_duration")),
        "server_decode_tps": rate(final.get("eval_count"), final.get("eval_duration")),
        "load_s": (final.get("load_duration") or 0) / NS,
    }


def run_llamacpp(host, model, prompt, num_ctx, predict):
    # llama-server takes its context from -c at startup, not per request.
    url = f"{host}/completion"
    payload = {
        "prompt": prompt,
        "n_predict": predict,
        "temperature": 0,
        "seed": 7,
        "cache_prompt": False,  # or the second run of a repeat measures nothing
        "stream": True,
    }
    t0 = time.perf_counter()
    t_first = None
    final = {}
    for line in http_stream(url, payload):
        if not line.startswith("data: "):
            continue
        chunk = json.loads(line[6:])
        if t_first is None and chunk.get("content"):
            t_first = time.perf_counter()
        if chunk.get("stop"):
            final = chunk
    t_end = time.perf_counter()
    timings = final.get("timings", {})
    return {
        "client_ttft_s": (t_first or t_end) - t0,
        "client_total_s": t_end - t0,
        "client_decode_tps": decode_tps(timings.get("predicted_n"), t_first, t_end),
        "prompt_tokens": timings.get("prompt_n"),
        "output_tokens": timings.get("predicted_n"),
        "server_prefill_tps": timings.get("prompt_per_second"),
        "server_decode_tps": timings.get("predicted_per_second"),
        "load_s": 0.0,
    }


def run_openai(host, model, prompt, num_ctx, predict):
    """Generic OpenAI-compatible server. Prefers /v1/completions, which takes
    the prompt as written; falls back to chat, which wraps it in a template and
    so adds a handful of tokens the client did not send."""
    headers = {"Authorization": f"Bearer {os.environ.get('OPENAI_API_KEY', 'not-needed')}"}
    common = {
        "model": model,
        "max_tokens": predict,
        "temperature": 0,
        "stream": True,
        "stream_options": {"include_usage": True},
    }
    endpoint, payload, field = f"{host}/v1/completions", {**common, "prompt": prompt}, "text"
    try:
        stream = http_stream(endpoint, payload, headers)
        first = next(stream)
    except urllib.error.HTTPError as err:
        if err.code not in (404, 400, 405):
            raise
        endpoint = f"{host}/v1/chat/completions"
        payload = {**common, "messages": [{"role": "user", "content": prompt}]}
        field = "delta"
        stream = http_stream(endpoint, payload, headers)
        first = next(stream)

    t0 = time.perf_counter()
    t_first = None
    usage = {}
    for line in [first, *stream]:
        if not line.startswith("data: "):
            continue
        body = line[6:]
        if body == "[DONE]":
            break
        chunk = json.loads(body)
        if chunk.get("usage"):
            usage = chunk["usage"]
        choices = chunk.get("choices") or []
        if t_first is None and choices:
            piece = choices[0].get(field) or {}
            text = piece if isinstance(piece, str) else piece.get("content")
            if text:
                t_first = time.perf_counter()
    t_end = time.perf_counter()
    out = usage.get("completion_tokens")
    return {
        "client_ttft_s": (t_first or t_end) - t0,
        "client_total_s": t_end - t0,
        "client_decode_tps": decode_tps(out, t_first, t_end),
        "prompt_tokens": usage.get("prompt_tokens"),
        "output_tokens": out,
        # No server-side split of the two phases: TTFT is the only prefill
        # signal this API shape gives, and it includes the network hop.
        "server_prefill_tps": None,
        "server_decode_tps": None,
        "load_s": 0.0,
    }


BACKENDS = {"ollama": run_ollama, "llamacpp": run_llamacpp, "openai": run_openai}
DEFAULT_HOST = {
    "ollama": "http://localhost:11434",
    "llamacpp": "http://localhost:8080",
    "openai": "http://localhost:1234",
}


def rate(count, duration_ns):
    if not count or not duration_ns:
        return None
    return count / (duration_ns / NS)


def decode_tps(count, t_first, t_end):
    """Tokens per second over the decode phase alone. The first token is
    excluded: it is produced by prefill, and counting it here would credit
    decode with work it did not do."""
    if not count or count < 2 or t_first is None:
        return None
    return (count - 1) / (t_end - t_first)


def calibrate(runner, host, model, target_tokens, num_ctx):
    """Build a prompt of roughly `target_tokens` tokens without shipping a
    tokenizer: send one short probe, see how many tokens the server counted,
    and scale the filler by the ratio it implies."""
    probe_text = FILLER * 4
    probe = runner(host, model, probe_text, num_ctx, 1)
    seen = probe.get("prompt_tokens")
    if not seen:
        raise SystemExit("the server did not report a prompt token count; cannot size the prompt")
    chars_per_token = len(probe_text) / seen
    reps = max(1, round(target_tokens * chars_per_token / len(FILLER)))
    return FILLER * reps


def vary(prompt, reuse_cache):
    """Make this run's prompt unique unless asked otherwise.

    Both servers keep a prefix cache: send the same prompt twice and the second
    call skips prefill entirely and reports a four-digit tokens/s that measures
    the cache, not the machine. A nonce at the *front* invalidates the whole
    prefix, so every run pays for its own prefill."""
    if reuse_cache:
        return prompt
    return f"[run {uuid.uuid4().hex}] {prompt}"


def summarise(records):
    """Median of each metric. Median, not mean: a single scheduling hiccup on a
    laptop is common and should not move the number."""
    out = {}
    for key in records[0]:
        values = [r[key] for r in records if r.get(key) is not None]
        out[key] = statistics.median(values) if values else None
    return out


def loaded_size(host, model):
    """What Ollama says it is holding in memory for this model, in GB."""
    try:
        for entry in http_json(f"{host}/api/ps").get("models", []):
            if entry.get("name") == model or entry.get("model") == model:
                return entry.get("size", 0) / 1e9
    except Exception:
        return None
    return None


def fmt(value, digits=1):
    return "—" if value is None else f"{value:,.{digits}f}"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--backend", choices=BACKENDS, default="ollama")
    ap.add_argument("--host", help=f"default per backend, e.g. {DEFAULT_HOST['ollama']}")
    ap.add_argument("--model", required=True, help="comma-separated; one row per model")
    ap.add_argument("--ctx", default="16384", help="comma-separated context sizes (ollama only)")
    ap.add_argument("--prompt-tokens", type=int, default=4700, help="prompt length to build; 4700 is the eval harness prompt")
    ap.add_argument("--predict", type=int, default=128, help="tokens to generate per run")
    ap.add_argument("--repeat", type=int, default=3, help="measured runs per cell, after one warm-up")
    ap.add_argument("--reuse-cache", action="store_true",
                    help="send the identical prompt every run, so the server's prefix cache answers it; "
                         "measures the cache rather than the machine")
    ap.add_argument("--label", default="", help="note stored with the run, e.g. the quantisation")
    ap.add_argument("--out", default="results", help="directory for the raw JSON")
    args = ap.parse_args()

    host = (args.host or DEFAULT_HOST[args.backend]).rstrip("/")
    runner = BACKENDS[args.backend]
    models = [m.strip() for m in args.model.split(",") if m.strip()]
    ctxs = [int(c) for c in args.ctx.split(",")]

    rows = []
    for model in models:
        prompt = calibrate(runner, host, model, args.prompt_tokens, max(ctxs))
        for num_ctx in ctxs:
            runner(host, model, vary(prompt, args.reuse_cache), num_ctx, args.predict)  # warm-up, discarded
            records = [
                runner(host, model, vary(prompt, args.reuse_cache), num_ctx, args.predict)
                for _ in range(args.repeat)
            ]
            row = summarise(records)
            row.update(
                backend=args.backend,
                model=model,
                label=args.label,
                num_ctx=num_ctx,
                prompt_target=args.prompt_tokens,
                resident_gb=loaded_size(host, model) if args.backend == "ollama" else None,
            )
            rows.append(row)
            print(f"  {model} @ {num_ctx}: {fmt(row['server_prefill_tps'])} tok/s prefill, "
                  f"{fmt(row['client_decode_tps'])} tok/s decode, "
                  f"{row['prompt_tokens']} prompt tokens seen", file=sys.stderr)

    print()
    print("| Model | ctx | Prompt tok sent → seen | Prefill tok/s (server / client) | Decode tok/s (server / client) | Resident |")
    print("|---|---|---|---|---|---|")
    for r in rows:
        seen = r["prompt_tokens"]
        truncated = seen is not None and seen < r["prompt_target"] * 0.9
        seen_cell = f"{r['prompt_target']:,} → {seen:,}" + (" **truncated**" if truncated else "")
        client_prefill = (seen / r["client_ttft_s"]) if seen and r["client_ttft_s"] else None
        label = f"{r['model']}{' ' + r['label'] if r['label'] else ''}"
        print(
            f"| {label} | {r['num_ctx']:,} | {seen_cell} "
            f"| {fmt(r['server_prefill_tps'])} / {fmt(client_prefill)} "
            f"| {fmt(r['server_decode_tps'])} / {fmt(r['client_decode_tps'])} "
            f"| {fmt(r['resident_gb'], 2)} GB |"
        )

    os.makedirs(args.out, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    path = os.path.join(args.out, f"bench-{stamp}.json")
    with open(path, "w") as fh:
        json.dump({"host": host, "args": vars(args), "rows": rows}, fh, indent=2)
    print(f"\nraw: {path}", file=sys.stderr)


if __name__ == "__main__":
    main()
