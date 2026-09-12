import { describe, expect, it } from "vitest";
import { bySection, fixedWindow, parseSections } from "./chunk";

const doc = {
  id: "test.md",
  text: [
    "# Title",
    "",
    "Intro paragraph before any section.",
    "",
    "## 1. First concept",
    "",
    "A".repeat(300),
    "",
    "## 2. Second concept",
    "",
    "B".repeat(300),
    "",
    "### A subsection",
    "",
    "C".repeat(300),
  ].join("\n"),
};

describe("parseSections", () => {
  it("captures the text before the first heading", () => {
    expect(parseSections(doc.text)[0].heading).toBe("(preamble)");
  });

  it("treats level 3 as a section of its own", () => {
    expect(parseSections(doc.text).map((s) => s.heading)).toEqual([
      "(preamble)",
      "1. First concept",
      "2. Second concept",
      "A subsection",
    ]);
  });
});

describe("bySection", () => {
  it("labels every chunk with exactly one section", () => {
    expect(bySection(doc).every((chunk) => chunk.headings.length === 1)).toBe(true);
  });

  it("splits a long section on paragraph boundaries and keeps the heading", () => {
    const long = {
      id: "long.md",
      text: `## Big\n\n${"x".repeat(900)}\n\n${"y".repeat(900)}\n\n${"z".repeat(900)}`,
    };
    const chunks = bySection(long, 1000);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.headings[0] === "Big")).toBe(true);
    // No paragraph was cut in half: each piece is whole runs of one letter.
    expect(chunks[1].text).toMatch(/^Big\n\n[xyz]+$/);
  });
});

describe("fixedWindow", () => {
  it("credits every section the window carries enough of", () => {
    // One window over the whole document covers all four sections.
    const [chunk] = fixedWindow(doc, doc.text.length, 0);
    expect(chunk.headings).toHaveLength(4);
  });

  it("does not credit a section it only clips", () => {
    // A window ending 20 characters into section 2 is not an answer for it.
    const start = doc.text.indexOf("## 2. Second concept");
    const strict = fixedWindow(doc, start + 20, 0);
    expect(strict[0].headings).not.toContain("2. Second concept");

    // The same window, labelled by any overlap at all, claims it — which is
    // the difference the `fixed-any` row in RETRIEVAL.md measures.
    const generous = fixedWindow(doc, start + 20, 0, 0);
    expect(generous[0].headings).toContain("2. Second concept");
  });
});
