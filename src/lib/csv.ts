import Papa from "papaparse";
import { MAX_DEMO_ROWS } from "@/lib/contracts";

export type ParsedCsv = {
  headers: string[];
  rows: Array<Record<string, string>>;
  /** True when the file had more rows than the demo cap allows. */
  truncated: boolean;
  totalSeen: number;
};

/**
 * Header normalisation: trimmed, blanks named positionally, duplicates
 * suffixed. Without this a CSV with two "email" columns silently loses one.
 */
export function normalizeHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();

  return raw.map((header, index) => {
    const base = header.trim() || `column_${index + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });
}

export function parseCsv(text: string, cap = MAX_DEMO_ROWS): ParsedCsv {
  const rows: Array<Record<string, string>> = [];
  let headers: string[] = [];
  let totalSeen = 0;
  let truncated = false;

  Papa.parse<string[]>(text, {
    skipEmptyLines: "greedy",
    step: (result, parser) => {
      const cells = result.data;

      if (headers.length === 0) {
        headers = normalizeHeaders(cells);
        return;
      }

      totalSeen++;
      if (rows.length >= cap) {
        truncated = true;
        parser.abort();
        return;
      }

      rows.push(
        Object.fromEntries(
          headers.map((header, index) => [header, (cells[index] ?? "").trim()]),
        ),
      );
    },
  });

  return { headers, rows, truncated, totalSeen };
}

/** Serialises rows back out, quoting only what needs it. */
export function toCsv(headers: string[], rows: Array<Record<string, string>>): string {
  return Papa.unparse(
    { fields: headers, data: rows.map((row) => headers.map((h) => row[h] ?? "")) },
    { newline: "\n" },
  );
}
