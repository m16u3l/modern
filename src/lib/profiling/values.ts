import type { InferredType } from "@/lib/contracts";

/**
 * Cell-level primitives shared by every detector. Pure string in, value out —
 * no I/O, no framework, no model. This is what makes the engine testable and
 * what would let it move to a separate service unchanged.
 */

/** Strings that mean "no value" even though the cell is not empty. */
export const MISSING_TOKENS = new Set([
  "",
  "-",
  "--",
  "?",
  "n/a",
  "na",
  "nil",
  "none",
  "null",
  "unknown",
]);

export function isMissing(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  return MISSING_TOKENS.has(value.trim().toLowerCase());
}

/** Lowercased, stripped of everything but letters and digits, accents folded. */
export function normalizeKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Collapses a value to its shape: digits become D, letters A, everything else
 * is kept. "(555) 010-2233" and "(555) 010-9911" share the shape
 * "(DDD) DDD-DDDD", so format minorities become countable \u2014 and the shape
 * doubles as a template for rewriting a minority value into the majority form.
 */
export function shapeOf(value: string): string {
  // One pass on purpose: replacing digits first would then match the "D" it
  // just wrote when replacing letters.
  return value
    .trim()
    .replace(/[0-9]|[a-zA-Z\u00c0-\u024f]/g, (char) =>
      char >= "0" && char <= "9" ? "D" : "A",
    );
}

/**
 * Pours `digits` into a shape produced by `shapeOf`. Returns null when the
 * counts do not line up, rather than silently truncating a phone number.
 */
export function applyShape(shape: string, digits: string): string | null {
  if (shape.split("").filter((c) => c === "D").length !== digits.length) {
    return null;
  }
  let index = 0;
  return shape.replace(/D/g, () => digits[index++]);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const PHONE_RE = /^\+?[\d\s().-]{7,}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SLASH_DATE_RE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;
const BOOLEAN_VALUES = new Set([
  "true",
  "false",
  "yes",
  "no",
  "y",
  "n",
  "0",
  "1",
]);

export function looksLikeEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

export function looksLikePhone(value: string): boolean {
  const trimmed = value.trim();
  return PHONE_RE.test(trimmed) && digitsOf(trimmed).length >= 7;
}

export function digitsOf(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Parses a number written in any of the notations that turn up in exports:
 * thousands separators, European decimal commas, currency prefixes.
 * Returns null when nothing numeric can be recovered.
 */
export function parseNumber(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;

  // Strip currency symbols and codes, keeping sign, digits and separators.
  const stripped = trimmed
    .replace(/^[A-Z]{3}\s*/i, "")
    .replace(/[$€£¥]/g, "")
    .replace(/\s/g, "");

  if (!/^[+-]?[\d.,]+$/.test(stripped)) return null;

  const lastComma = stripped.lastIndexOf(",");
  const lastDot = stripped.lastIndexOf(".");

  let canonical: string;
  if (lastComma === -1 && lastDot === -1) {
    canonical = stripped;
  } else if (lastComma > lastDot) {
    // Comma is the decimal separator: "1.234,56" or "4120,00".
    canonical = stripped.replace(/\./g, "").replace(",", ".");
  } else {
    // Dot is the decimal separator: "1,234.56".
    canonical = stripped.replace(/,/g, "");
  }

  const parsed = Number(canonical);
  return Number.isFinite(parsed) ? parsed : null;
}

export function looksLikeNumber(value: string): boolean {
  return parseNumber(value) !== null;
}

/** True when the value is already written as a plain machine-readable number. */
export function isCanonicalNumber(value: string): boolean {
  return /^[+-]?\d+(\.\d+)?$/.test(value.trim());
}

/**
 * Rewrites a number into plain form while preserving the author's precision:
 * "USD 2050.00" stays "2050.00" rather than collapsing to "2050".
 */
export function canonicalNumberString(value: string): string | null {
  if (parseNumber(value) === null) return null;

  const stripped = value
    .trim()
    .replace(/^[A-Z]{3}\s*/i, "")
    .replace(/[$€£¥]/g, "")
    .replace(/\s/g, "");

  const lastComma = stripped.lastIndexOf(",");
  const lastDot = stripped.lastIndexOf(".");

  if (lastComma === -1 && lastDot === -1) return stripped;
  if (lastComma > lastDot) {
    return stripped.replace(/\./g, "").replace(",", ".");
  }
  return stripped.replace(/,/g, "");
}

export type ParsedDate = {
  iso: string;
  /** True when the source could be read as either DD/MM or MM/DD. */
  ambiguous: boolean;
};

/**
 * Normalises a date to ISO. Slash dates are read as DD/MM/YYYY unless the first
 * component cannot be a day, and are reported ambiguous when both readings are
 * valid — the caller decides whether that is good enough to auto-apply.
 */
export function parseDate(value: string): ParsedDate | null {
  const trimmed = value.trim();

  if (ISO_DATE_RE.test(trimmed)) {
    const [year, month, day] = trimmed.split("-").map(Number);
    return isValidYmd(year, month, day)
      ? { iso: trimmed, ambiguous: false }
      : null;
  }

  const match = SLASH_DATE_RE.exec(trimmed);
  if (!match) return null;

  const first = Number(match[1]);
  const second = Number(match[2]);
  const year = Number(match[3]);

  const dayFirst = isValidYmd(year, second, first);
  const monthFirst = isValidYmd(year, first, second);

  if (dayFirst && monthFirst) {
    return { iso: toIso(year, second, first), ambiguous: first !== second };
  }
  if (dayFirst) return { iso: toIso(year, second, first), ambiguous: false };
  if (monthFirst) return { iso: toIso(year, first, second), ambiguous: false };
  return null;
}

export function looksLikeDate(value: string): boolean {
  return parseDate(value) !== null;
}

function isValidYmd(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || year < 1000 || year > 9999) {
    return false;
  }
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function toIso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Classifies a single non-missing value. Order matters: narrowest first. */
export function classifyValue(value: string): InferredType {
  const trimmed = value.trim();
  if (looksLikeEmail(trimmed)) return "email";
  if (looksLikeDate(trimmed)) return "date";
  if (BOOLEAN_VALUES.has(trimmed.toLowerCase()) && !/^\d+$/.test(trimmed)) {
    return "boolean";
  }
  if (looksLikeNumber(trimmed)) return "number";
  if (looksLikePhone(trimmed)) return "phone";
  return "string";
}

/**
 * Whether a value is acceptable for a column of this type. Deliberately looser
 * than `classifyValue`: an unpunctuated phone number is still a phone number,
 * and flagging it as a type mismatch would double-report a format issue.
 */
export function matchesType(value: string, type: InferredType): boolean {
  const trimmed = value.trim();
  switch (type) {
    case "email":
      return looksLikeEmail(trimmed);
    case "phone":
      return looksLikePhone(trimmed);
    case "number":
      return looksLikeNumber(trimmed);
    case "date":
      return looksLikeDate(trimmed);
    case "boolean":
      return BOOLEAN_VALUES.has(trimmed.toLowerCase());
    case "string":
    case "mixed":
      return true;
  }
}

/**
 * Levenshtein distance with an early exit: once the best possible result
 * exceeds `max`, the exact number stops mattering.
 */
export function levenshtein(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  const current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    let rowMin = current[0];

    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost,
      );
      if (current[j] < rowMin) rowMin = current[j];
    }

    if (rowMin > max) return max + 1;
    previous = current.slice();
  }

  return previous[b.length];
}

/** 1 for identical strings, 0 for nothing in common. */
export function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - levenshtein(a, b) / longest;
}
