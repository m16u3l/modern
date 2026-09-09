# agents — week 5

Planner / worker / critic roles, built as a loop instead of a one-shot call.

## Status

Not started.

## Why this pairs with the app

`src/app/api/datasets/[id]/enrich/route.ts` makes exactly one call today. The
app-side build turns it into a loop: a critic reviewing verdicts under
`LOW_CONFIDENCE_THRESHOLD` (0.7), retry with a larger model through week 3's
router, and tool calling so the model can ask for more rows instead of only
receiving the ones handed to it.

Week 2 found the complication: `qwen2.5:7b` returns 0.95 confidence whether it is
right or wrong, so a critic gated on confidence would never fire for that model.
**The gate has to be calibrated per model before the loop is built on it.**

`maxDuration = 60` on the route is a hard ceiling and forces rethinking the
chunking.

## Deliverable

One-shot vs. loop measured in the same harness: does accuracy go up, and how much
more does it cost?
