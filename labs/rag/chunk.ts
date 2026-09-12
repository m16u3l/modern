import type { Doc } from "./corpus";

/**
 * A retrievable passage. `headings` are the sections its text covers, and they
 * are the unit the ground truth is labelled in — the same labels survive a
 * change of chunking strategy, which is the only way two strategies can be
 * compared on one query set.
 *
 * It is a list, not a single heading, because a fixed window can open in one
 * section and carry the whole of the next. Crediting it only with the section
 * it opened in measures the labelling rule instead of the retrieval.
 */
export type Chunk = {
  id: string;
  docId: string;
  headings: string[];
  text: string;
};

/**
 * The character budget every chunk lives within, and it is not a taste
 * decision: `all-minilm` holds ~512 tokens, which this corpus fills at roughly
 * 1,200 characters of dense markdown. A chunk above it used to come back
 * silently truncated, which made the small model's score partly a measurement
 * of the truncation. Both strategies share the budget, so section chunks and
 * fixed windows are also being compared at the same size.
 */
export const CHUNK_BUDGET = 1200;

type Section = { heading: string; start: number; end: number };

const HEADING = /^#{2,3} .*$/gm;

/** Markdown sections at heading level 2 and 3, in document order. */
export function parseSections(text: string): Section[] {
  const matches = [...text.matchAll(HEADING)];
  const sections: Section[] = [];

  if (matches.length === 0 || matches[0].index > 0) {
    sections.push({
      heading: "(preamble)",
      start: 0,
      end: matches.length ? matches[0].index : text.length,
    });
  }

  matches.forEach((match, i) => {
    sections.push({
      heading: match[0].replace(/^#+\s*/, "").trim(),
      start: match.index,
      end: i + 1 < matches.length ? matches[i + 1].index : text.length,
    });
  });

  return sections;
}

/**
 * One chunk per section, which is what a document with headings is already
 * offering. Sections longer than `maxChars` are split on paragraph boundaries
 * rather than mid-sentence, and every piece keeps the heading text so a chunk
 * retrieved on its own still says what it is about.
 */
export function bySection(doc: Doc, maxChars = CHUNK_BUDGET): Chunk[] {
  const chunks: Chunk[] = [];

  for (const section of parseSections(doc.text)) {
    const body = doc.text.slice(section.start, section.end).trim();
    if (!body) continue;

    // The heading is prepended to every piece that does not already start with
    // one, so the split has to leave room for it or the budget is missed by
    // exactly the length of the title.
    const room = maxChars - section.heading.length - 2;

    for (const piece of splitParagraphs(body, room)) {
      chunks.push({
        id: `${doc.id}#${chunks.length}`,
        docId: doc.id,
        headings: [section.heading],
        text: piece.startsWith("#") ? piece : `${section.heading}\n\n${piece}`,
      });
    }
  }

  return chunks;
}

/**
 * Character windows, ignoring the structure entirely. The naive strategy, kept
 * because it is the one to beat: if section-aware chunking is not worth its
 * complexity, this is what proves it.
 */
export function fixedWindow(
  doc: Doc,
  size = CHUNK_BUDGET,
  overlap = 200,
  minCoverage = 0.5,
): Chunk[] {
  const sections = parseSections(doc.text);
  const chunks: Chunk[] = [];
  const step = size - overlap;

  for (let start = 0; start < doc.text.length; start += step) {
    const text = doc.text.slice(start, start + size).trim();
    if (!text) continue;

    // Every section the window carries enough of, not only the one it opens
    // in. `minCoverage` is the whole argument: at 0 a window that clips ten
    // characters off a section is credited with answering for it, and the
    // strategy scores well for reasons that have nothing to do with retrieval.
    const end = Math.min(start + size, doc.text.length);
    const covered = sections.filter((s) => {
      const overlapping = Math.min(end, s.end) - Math.max(start, s.start);
      if (overlapping <= 0) return false;
      // A section larger than the window is covered when the window sits
      // inside it; a smaller one, when the window holds most of it.
      return overlapping / Math.min(s.end - s.start, size) >= minCoverage;
    });

    if (covered.length === 0) continue;

    chunks.push({
      id: `${doc.id}#${chunks.length}`,
      docId: doc.id,
      headings: covered.map((s) => s.heading),
      text,
    });
  }

  return chunks;
}

/**
 * Greedy paragraph packing up to `maxChars`, preferring not to split a
 * paragraph — but a budget that is only advisory is not a budget. A markdown
 * table is a single paragraph with no blank line in it, and leaving those whole
 * kept 933-character chunks alive at a budget of 600, which is how a chunk ends
 * up too large for the model that has to embed it. So an oversized paragraph
 * falls back to line boundaries, and an oversized line to a hard cut.
 */
function splitParagraphs(body: string, maxChars: number): string[] {
  if (body.length <= maxChars) return [body];

  const pieces: string[] = [];
  let current = "";

  const flush = () => {
    if (current) pieces.push(current);
    current = "";
  };

  for (const paragraph of body.split(/\n\n+/)) {
    if (current && current.length + paragraph.length + 2 > maxChars) flush();

    if (paragraph.length <= maxChars) {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
      continue;
    }

    flush();
    for (const line of splitLines(paragraph, maxChars)) pieces.push(line);
  }

  flush();
  return pieces;
}

/** Line-level packing, with a hard cut for a single line over budget. */
function splitLines(paragraph: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let current = "";

  for (const line of paragraph.split("\n")) {
    if (current && current.length + line.length + 1 > maxChars) {
      pieces.push(current);
      current = "";
    }

    if (line.length > maxChars) {
      for (let i = 0; i < line.length; i += maxChars) {
        pieces.push(line.slice(i, i + maxChars));
      }
      continue;
    }

    current = current ? `${current}\n${line}` : line;
  }

  if (current) pieces.push(current);
  return pieces;
}

export const STRATEGIES = {
  section: (doc: Doc) => bySection(doc),
  fixed: (doc: Doc) => fixedWindow(doc),
  // Same windows, labelled by any overlap at all. It is in the table to show
  // how much of a fixed-window score is the labelling rule rather than the
  // retrieval — see RETRIEVAL.md.
  "fixed-any": (doc: Doc) => fixedWindow(doc, CHUNK_BUDGET, 200, 0),
} satisfies Record<string, (doc: Doc) => Chunk[]>;

export type StrategyName = keyof typeof STRATEGIES;
