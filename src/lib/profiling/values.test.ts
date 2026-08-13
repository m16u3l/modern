import { describe, expect, it } from "vitest";
import {
  applyShape,
  canonicalNumberString,
  classifyValue,
  isCanonicalNumber,
  isMissing,
  levenshtein,
  matchesType,
  normalizeKey,
  parseDate,
  parseNumber,
  shapeOf,
  similarity,
} from "./values";

describe("isMissing", () => {
  it("treats disguised nulls as missing", () => {
    for (const value of ["", "  ", "N/A", "n/a", "-", "unknown", "NULL", "?"]) {
      expect(isMissing(value), value).toBe(true);
    }
  });

  it("keeps real values", () => {
    for (const value of ["0", "false", "none of the above", "na-me"]) {
      expect(isMissing(value), value).toBe(false);
    }
  });
});

describe("normalizeKey", () => {
  it("folds accents, case and punctuation", () => {
    expect(normalizeKey("Ana María Torres")).toBe(normalizeKey("ana maria torres"));
    expect(normalizeKey("O'Neill")).toBe(normalizeKey("ONeill"));
    expect(normalizeKey("Carlos Ruíz")).toBe("carlosruiz");
  });
});

describe("shapeOf / applyShape", () => {
  it("gives phones in the same format the same shape", () => {
    expect(shapeOf("(555) 010-2233")).toBe(shapeOf("(555) 010-9911"));
    expect(shapeOf("555-010-4411")).not.toBe(shapeOf("(555) 010-2233"));
  });

  it("rewrites digits into a target shape", () => {
    expect(applyShape("(DDD) DDD-DDDD", "5550104411")).toBe("(555) 010-4411");
  });

  it("refuses to rewrite when the digit count disagrees", () => {
    expect(applyShape("(DDD) DDD-DDDD", "555010")).toBeNull();
  });
});

describe("parseNumber", () => {
  it("reads the notations that turn up in real exports", () => {
    expect(parseNumber("1240.50")).toBe(1240.5);
    expect(parseNumber("1,680.50")).toBe(1680.5);
    expect(parseNumber("4120,00")).toBe(4120);
    expect(parseNumber("USD 2050.00")).toBe(2050);
    expect(parseNumber("-450.00")).toBe(-450);
  });

  it("returns null for values with no numeric content", () => {
    expect(parseNumber("abc")).toBeNull();
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("N/A")).toBeNull();
  });
});

describe("canonicalNumberString", () => {
  it("preserves the author's precision", () => {
    expect(canonicalNumberString("USD 2050.00")).toBe("2050.00");
    expect(canonicalNumberString("4120,00")).toBe("4120.00");
    expect(canonicalNumberString("1,680.50")).toBe("1680.50");
  });

  it("recognises values that are already canonical", () => {
    expect(isCanonicalNumber("1240.50")).toBe(true);
    expect(isCanonicalNumber("USD 2050.00")).toBe(false);
    expect(isCanonicalNumber("4120,00")).toBe(false);
  });
});

describe("parseDate", () => {
  it("passes ISO dates through", () => {
    expect(parseDate("2024-01-05")).toEqual({ iso: "2024-01-05", ambiguous: false });
  });

  it("resolves slash dates as day-first", () => {
    expect(parseDate("05/02/2024")?.iso).toBe("2024-02-05");
  });

  it("flags dates that read both ways as ambiguous", () => {
    expect(parseDate("05/02/2024")?.ambiguous).toBe(true);
    expect(parseDate("11/03/2024")?.ambiguous).toBe(true);
  });

  it("resolves unambiguously when the first field cannot be a month", () => {
    const parsed = parseDate("06/15/2024");
    expect(parsed).toEqual({ iso: "2024-06-15", ambiguous: false });
  });

  it("rejects impossible dates", () => {
    expect(parseDate("2024-02-31")).toBeNull();
    expect(parseDate("32/13/2024")).toBeNull();
    expect(parseDate("not a date")).toBeNull();
  });
});

describe("classifyValue", () => {
  it("picks the narrowest matching type", () => {
    expect(classifyValue("ana@example.com")).toBe("email");
    expect(classifyValue("2024-01-05")).toBe("date");
    expect(classifyValue("1240.50")).toBe("number");
    expect(classifyValue("(555) 010-2233")).toBe("phone");
    expect(classifyValue("Ana María Torres")).toBe("string");
  });
});

describe("matchesType", () => {
  it("accepts an unpunctuated phone in a phone column", () => {
    // Otherwise a format issue would be double-reported as a type mismatch.
    expect(matchesType("5550104411", "phone")).toBe(true);
  });

  it("rejects a broken email in an email column", () => {
    expect(matchesType("lucia.fernandez@example", "email")).toBe(false);
  });

  it("accepts anything in a string or mixed column", () => {
    expect(matchesType("whatever", "string")).toBe(true);
    expect(matchesType("whatever", "mixed")).toBe(true);
  });
});

describe("levenshtein / similarity", () => {
  it("measures edit distance", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("same", "same")).toBe(0);
  });

  it("bails out early once the budget is blown", () => {
    expect(levenshtein("abcdefghij", "zzzzzzzzzz", 3)).toBeGreaterThan(3);
  });

  it("scores near-identical strings close to 1", () => {
    expect(similarity("Nowak", "Novak")).toBeGreaterThan(0.7);
    expect(similarity("Isabella", "Isabela")).toBeGreaterThan(0.8);
    expect(similarity("alpha", "omega")).toBeLessThan(0.5);
  });
});
