import { readFileSync } from "node:fs";
import path from "node:path";

/** A source file, before it is cut into anything. */
export type Doc = { id: string; text: string };

const SNAPSHOT = path.join(import.meta.dirname, "snapshot");

/**
 * The corpus is this repo's own write-ups. That is not a shortcut: a retrieval
 * eval needs to know which passage answers which question, and these documents
 * already carry that structure — every concept in LEARNING.md is a titled
 * section that answers one question and no other. Ground truth without a
 * labelling session.
 *
 * It is read from `snapshot/`, not from the repo root, and that copy is the
 * whole point. Writing up a result adds concepts to LEARNING.md, which edits
 * the corpus the result was measured on: two runs a day apart were scored over
 * 74 and then 97 chunks, and neither number could be reproduced afterwards.
 * A frozen copy makes every row in RETRIEVAL.md reproducible by anyone.
 *
 * Refreshing it is a deliberate act that invalidates the table — see
 * `npm run rag:snapshot` and the note in RETRIEVAL.md.
 */
export const CORPUS_FILES = ["LEARNING.md", "EVALS.md", "PLAN.md"];

export function loadCorpus(files: string[] = CORPUS_FILES): Doc[] {
  return files.map((file) => ({
    id: file,
    text: readFileSync(path.join(SNAPSHOT, file), "utf8"),
  }));
}
