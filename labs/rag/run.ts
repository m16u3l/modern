/**
 * Scores retrieval strategies over the corpus in `corpus.ts`.
 *
 *   npx tsx labs/rag/run.ts                    # every combination, k = 5
 *   npx tsx labs/rag/run.ts --k 3 --misses     # tighter window, list failures
 *   npx tsx labs/rag/run.ts --ask "why ..."    # one question, what came back
 *   npx tsx labs/rag/run.ts --rerank           # adds the rerank pass (minutes)
 *
 * Needs ollama serving locally; nothing here calls a hosted provider.
 */
import { createHash } from "node:crypto";
import { bySection, CHUNK_BUDGET, STRATEGIES, type Chunk, type StrategyName } from "./chunk";
import { CORPUS_FILES, loadCorpus, type Doc } from "./corpus";
import { EMBED_MODELS } from "./embed";
import { ndcgAt, recallAt, reciprocalRank } from "./metrics";
import { QUERIES } from "./queries";
import { llmReranker, RERANK_MODEL, withRerank } from "./rerank";
import {
  buildIndexes,
  hybridRetriever,
  lexicalRetriever,
  vectorRetriever,
  NOMIC_PREFIX,
  type Retriever,
} from "./retrieve";

type Row = {
  run: string;
  chunks: number;
  recall: number;
  mrr: number;
  ndcg: number;
  seconds: number;
  misses: string[];
};

/** The largest chunk `all-minilm` accepts from this corpus, measured. */
const SMALL_MODEL_BUDGET = 500;

const args = process.argv.slice(2);
const k = Number(flag("--k") ?? 5);
const showMisses = args.includes("--misses");
/** Off by default: a rerank pass is minutes, and the table above is seconds. */
const withReranking = args.includes("--rerank");
const RERANK_DEPTH = 10;

async function main() {
  const corpus = loadCorpus();

  const question = flag("--ask");
  if (question) return ask(corpus, question);

  const chunked = Object.fromEntries(
    Object.entries(STRATEGIES).map(([name, split]) => [
      name,
      corpus.flatMap((doc) => split(doc)),
    ]),
  ) as Record<StrategyName, Chunk[]>;

  validateGroundTruth(chunked.section);
  fingerprint(corpus);

  const rows: Row[] = [];

  // Table 1: retrievers and chunking, on the larger embedding model.
  let sectionIndexes!: Awaited<ReturnType<typeof buildIndexes>>;

  for (const strategy of Object.keys(chunked) as StrategyName[]) {
    const indexes = await buildIndexes(chunked[strategy], EMBED_MODELS[0].name);
    if (strategy === "section") sectionIndexes = indexes;

    rows.push(
      await score(`vector / ${strategy}`, chunked[strategy].length, vectorRetriever(indexes)),
      await score(`bm25 / ${strategy}`, chunked[strategy].length, lexicalRetriever(indexes)),
      await score(`hybrid / ${strategy}`, chunked[strategy].length, hybridRetriever(indexes)),
    );
  }

  // Table 2: the smaller embedding model, at the only budget it can hold.
  // 512 tokens is about 500 characters of this corpus — markdown tables and
  // backticks tokenise close to one character each — so it cannot be given the
  // same chunks as the model above. Asking it to is how the first version of
  // this table measured silent truncation instead of the model.
  const smallChunks = corpus.flatMap((doc) => bySection(doc, SMALL_MODEL_BUDGET));
  const small = await buildIndexes(smallChunks, EMBED_MODELS[1].name);
  rows.push(
    await score(
      `vector / section@${SMALL_MODEL_BUDGET} / ${EMBED_MODELS[1].label}`,
      smallChunks.length,
      vectorRetriever(small),
    ),
    await score(
      `hybrid / section@${SMALL_MODEL_BUDGET} / ${EMBED_MODELS[1].label}`,
      smallChunks.length,
      hybridRetriever(small),
    ),
  );

  // The same small chunks through the large model, so the budget change and the
  // model change are not the same column.
  const largeSmallChunks = await buildIndexes(smallChunks, EMBED_MODELS[0].name);
  rows.push(
    await score(
      `vector / section@${SMALL_MODEL_BUDGET} / ${EMBED_MODELS[0].label}`,
      smallChunks.length,
      vectorRetriever(largeSmallChunks),
    ),
  );

  // Table 3: the same model and chunks, asked with the instruction prefixes it
  // was trained on.
  const prefixed = await buildIndexes(
    chunked.section,
    EMBED_MODELS[0].name,
    NOMIC_PREFIX,
  );
  rows.push(
    await score(
      "vector / section / prefixed",
      chunked.section.length,
      vectorRetriever(prefixed),
    ),
    await score(
      "hybrid / section / prefixed",
      chunked.section.length,
      hybridRetriever(prefixed),
    ),
  );

  if (withReranking) {
    const rerank = llmReranker();
    const depth = RERANK_DEPTH;

    rows.push(
      await score(
        `vector → rerank / section / ${RERANK_MODEL}`,
        chunked.section.length,
        withRerank(vectorRetriever(sectionIndexes), rerank, depth),
      ),
      await score(
        `hybrid → rerank / section / ${RERANK_MODEL}`,
        chunked.section.length,
        withRerank(hybridRetriever(sectionIndexes), rerank, depth),
      ),
    );
  }

  report(rows);
}

/**
 * One question, all three retrievers, no scoring. The eval answers "how often",
 * which is the number that belongs in a document; this answers "what came back",
 * which is the only way to tell whether a miss is the retriever's fault or the
 * question's.
 */
async function ask(corpus: Doc[], question: string): Promise<void> {
  const chunks = corpus.flatMap((doc) => STRATEGIES.section(doc));
  const indexes = await buildIndexes(chunks, EMBED_MODELS[0].name);

  fingerprint(corpus);
  console.log(`\n"${question}"`);

  const retrievers: Array<[string, Retriever]> = [
    ["vector", vectorRetriever(indexes)],
    ["bm25", lexicalRetriever(indexes)],
    ["hybrid", hybridRetriever(indexes)],
  ];

  for (const [name, retrieve] of retrievers) {
    console.log(`\n${name}`);

    for (const [rank, hit] of (await retrieve(question, k)).entries()) {
      console.log(
        `  ${rank + 1}. ${hit.score.toFixed(3)}  ${hit.chunk.headings.join(" + ")}` +
          `  (${hit.chunk.docId})`,
      );
    }
  }
}

async function score(run: string, chunks: number, retrieve: Retriever): Promise<Row> {
  const started = Date.now();
  let recall = 0;
  let mrr = 0;
  let ndcg = 0;
  const misses: string[] = [];

  for (const query of QUERIES) {
    const relevant = new Set(query.relevant);
    const hits = await retrieve(query.question, k);
    // A chunk stands for a section it covers: the relevant one when it carries
    // it, its opening section otherwise.
    const ranked = hits.map(
      (hit) =>
        hit.chunk.headings.find((heading) => relevant.has(heading)) ?? hit.chunk.headings[0],
    );

    const queryRecall = recallAt(ranked, relevant, k);
    recall += queryRecall;
    mrr += reciprocalRank(ranked, relevant);
    ndcg += ndcgAt(ranked, relevant, k);

    if (queryRecall === 0) {
      misses.push(`${query.question}\n      got: ${ranked.slice(0, 3).join(" | ") || "(nothing)"}`);
    }
  }

  const n = QUERIES.length;
  return {
    run,
    chunks,
    recall: recall / n,
    mrr: mrr / n,
    ndcg: ndcg / n,
    seconds: (Date.now() - started) / 1000,
    misses,
  };
}

/**
 * The corpus is this repo's own documents, so writing up a result edits the
 * thing the result was measured on. Every table therefore prints what it was
 * measured against: a table without this line cannot be reproduced.
 */
function fingerprint(corpus: Doc[]): void {
  const digest = createHash("sha256")
    .update(corpus.map((doc) => doc.text).join("\u0000"))
    .digest("hex")
    .slice(0, 8);

  console.log(
    `corpus ${CORPUS_FILES.join(", ")} @ ${digest}, ` +
      `${corpus.reduce((n, doc) => n + doc.text.length, 0).toLocaleString()} chars, ` +
      `budget ${CHUNK_BUDGET}`,
  );
}

/**
 * A query labelled with a heading the corpus does not contain is unanswerable,
 * and it would show up as a retrieval failure rather than as the typo it is.
 */
function validateGroundTruth(chunks: Chunk[]): void {
  const headings = new Set(chunks.flatMap((chunk) => chunk.headings));
  const unknown = QUERIES.flatMap((query) =>
    query.relevant.filter((heading) => !headings.has(heading)),
  );

  if (unknown.length) {
    throw new Error(
      `ground truth names ${unknown.length} heading(s) that are not in the corpus:\n  ` +
        unknown.join("\n  "),
    );
  }
}

function report(rows: Row[]): void {
  console.log(`\n${QUERIES.length} queries, k = ${k}\n`);
  console.log(`| Run | Chunks | Recall@${k} | MRR | nDCG@${k} | Time |`);
  console.log("|---|---|---|---|---|---|");

  for (const row of rows) {
    console.log(
      `| ${row.run} | ${row.chunks} | ${pct(row.recall)} | ${row.mrr.toFixed(2)} | ` +
        `${row.ndcg.toFixed(2)} | ${row.seconds.toFixed(1)}s |`,
    );
  }

  if (!showMisses) return;

  for (const row of rows.filter((r) => r.misses.length)) {
    console.log(`\n${row.run} missed ${row.misses.length}:`);
    for (const miss of row.misses) console.log(`  - ${miss}`);
  }
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function flag(name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
