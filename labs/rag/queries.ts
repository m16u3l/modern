/**
 * The ground truth: a question, and the section headings that answer it.
 *
 * Two rules were followed writing these, and both matter more than the number
 * of queries:
 *
 * 1. **Phrased as a person would ask, not as the document says it.** Reusing
 *    the heading's own words hands BM25 the answer and turns the hybrid
 *    comparison into theatre.
 * 2. **Labelled by heading, not by chunk id.** Chunk ids change with the
 *    chunking strategy; headings do not, which is what lets one query set score
 *    every strategy. `run.ts` fails loudly if a heading here is not in the
 *    corpus, so a renamed section cannot quietly become an unanswerable query.
 */
export type Query = { question: string; relevant: string[] };

export const QUERIES: Query[] = [
  {
    question:
      "why did the same weights score four times better after changing one environment variable?",
    relevant: [
      "21. Silent prompt truncation",
      "20. The context window is a serving parameter, not a model property",
    ],
  },
  {
    question: "is setting the sampler to zero enough to get the same answer twice?",
    relevant: ["7. Determinism, and why `temperature: 0` is not enough"],
  },
  {
    question:
      "how many samples should I take before designing a system around a weakness I measured?",
    relevant: ["31. One run is not a property"],
  },
  {
    question:
      "did sending each question to the model that is best at it make the system more accurate?",
    relevant: ["32. What routing actually buys"],
  },
  {
    question: "can I put two models behind one name and let whichever is faster answer?",
    relevant: ["33. Load balancing is not routing"],
  },
  {
    question: "everything runs on a free tier, so where would a dollar figure even come from?",
    relevant: ["34. A gateway is where prices live"],
  },
  {
    question: "will seven billion parameters at sixteen bits fit on this laptop?",
    relevant: ["28. The memory arithmetic of serving"],
  },
  {
    question: "the benchmark reported a throughput that cannot be real. what happened?",
    relevant: [
      "26. The prefix cache, and the benchmark that measured it",
      "A benchmark that measured the cache",
    ],
  },
  {
    question: "does keeping more bits per weight make the answers better?",
    relevant: [
      "27. What more bits actually buy",
      "Q8_0: twice the bits, no accuracy",
      "22. Quantisation, and why it was not the problem",
    ],
  },
  {
    question: "reading the prompt and writing the answer do not run at the same speed. why?",
    relevant: ["23. Prefill vs decode"],
  },
  {
    question: "the model returned json that matches the schema. can I trust the values?",
    relevant: ["9. Output sanitisation: treating the model as untrusted input"],
  },
  {
    question: "some of the questions came back with no answer at all. where do those go?",
    relevant: ["10. Unanswered candidates"],
  },
  {
    question: "the model name I wrote down last month now returns an error. why?",
    relevant: ["17. Model catalogues expire"],
  },
  {
    question:
      "the same client library talks to another provider, so the calls behave the same way?",
    relevant: ['18. "OpenAI-compatible" does not mean identical'],
  },
  {
    question: "how do I know a model is doing better than no model at all?",
    relevant: ["4. Baseline", "19. The baseline, no longer as a concept but as a result"],
  },
  {
    question: "does a high self-reported score mean the answer is more likely to be right?",
    relevant: ["6. Confidence calibration", "16. Inverted calibration (the real case)"],
  },
  {
    question: "who decided which answer counts as the correct one?",
    relevant: ["2. Ground truth"],
  },
  {
    question: "my first scoring rule made the best model look mediocre. what was wrong with it?",
    relevant: ["14. Metric design: action equivalence"],
  },
  {
    question: "the free tier stops answering halfway through a run. what does the code do?",
    relevant: ["11. Rate limits and exponential backoff"],
  },
  {
    question: "which kind of question do the small models fall apart on?",
    relevant: [
      "12. Accuracy by type: the table the router comes from",
      "25. The same per-category collapse, from a different model",
    ],
  },
  {
    question: "does a model running on my own machine report honest confidence?",
    relevant: ["24. Local does not mean safe: flat confidence"],
  },
  {
    question: "why was comparing two runtimes harder than comparing two models?",
    relevant: ["30. Comparing runtimes is harder than comparing models"],
  },
  {
    question: "what does the serving software cost compared to running the weights directly?",
    relevant: [
      "29. The serving stack is not free",
      "The serving stack costs 13% of prefill",
    ],
  },
  {
    question: "how do I swap one provider for another without touching the rest of the code?",
    relevant: ["13. The Port / Adapter pattern (already in the repo)"],
  },
  {
    question: "splitting the batch across two models — what did that do to the token bill?",
    relevant: ["Routing costs 40% more input tokens"],
  },
];
