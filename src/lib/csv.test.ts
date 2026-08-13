import { describe, expect, it } from "vitest";
import { normalizeHeaders, parseCsv, toCsv } from "./csv";
import { FIXTURE_ROWS } from "./fixtures";

describe("normalizeHeaders", () => {
  it("trims and keeps distinct names", () => {
    expect(normalizeHeaders([" email ", "phone"])).toEqual(["email", "phone"]);
  });

  it("names blank headers positionally", () => {
    expect(normalizeHeaders(["id", "", "  "])).toEqual([
      "id",
      "column_2",
      "column_3",
    ]);
  });

  it("suffixes duplicates instead of silently dropping a column", () => {
    expect(normalizeHeaders(["email", "email", "email"])).toEqual([
      "email",
      "email_2",
      "email_3",
    ]);
  });
});

describe("parseCsv", () => {
  it("reads headers and rows", () => {
    const { headers, rows } = parseCsv("a,b\n1,2\n3,4\n");

    expect(headers).toEqual(["a", "b"]);
    expect(rows).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ]);
  });

  it("keeps quoted commas and trims surrounding whitespace", () => {
    const { rows } = parseCsv('name,note\n"Torres, Ana", hello \n');

    expect(rows[0]).toEqual({ name: "Torres, Ana", note: "hello" });
  });

  it("preserves empty cells rather than shifting columns", () => {
    const { rows } = parseCsv("a,b,c\n1,,3\n");

    expect(rows[0]).toEqual({ a: "1", b: "", c: "3" });
  });

  it("stops at the row cap and says so", () => {
    const text = ["n", ...Array.from({ length: 50 }, (_, i) => String(i))].join("\n");
    const { rows, truncated } = parseCsv(text, 10);

    expect(rows).toHaveLength(10);
    expect(truncated).toBe(true);
  });

  it("does not report truncation for a file inside the cap", () => {
    expect(parseCsv("a\n1\n2\n", 10).truncated).toBe(false);
  });

  it("returns nothing usable for an empty file", () => {
    expect(parseCsv("").rows).toEqual([]);
  });
});

describe("toCsv", () => {
  it("round-trips the seeded messy table without losing a cell", () => {
    const headers = Object.keys(FIXTURE_ROWS[0].data);
    const text = toCsv(
      headers,
      FIXTURE_ROWS.map((row) => row.data),
    );
    const { headers: parsedHeaders, rows } = parseCsv(text);

    expect(parsedHeaders).toEqual(headers);
    expect(rows).toHaveLength(FIXTURE_ROWS.length);
    expect(rows).toEqual(FIXTURE_ROWS.map((row) => row.data));
  });

  it("quotes values containing the delimiter", () => {
    const text = toCsv(["name"], [{ name: "Torres, Ana" }]);
    expect(text).toContain('"Torres, Ana"');
  });
});
