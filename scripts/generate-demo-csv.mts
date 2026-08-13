/**
 * Regenerates demo/messy-customers.csv from the fixtures, so the file humans
 * download and the table the tests assert against never drift apart.
 *
 *   npx tsx scripts/generate-demo-csv.mts
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toCsv } from "../src/lib/csv";
import { FIXTURE_ROWS } from "../src/lib/fixtures";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const headers = Object.keys(FIXTURE_ROWS[0].data);
const csv = toCsv(headers, FIXTURE_ROWS.map((row) => row.data));

writeFileSync(path.join(root, "demo/messy-customers.csv"), csv + "\n", "utf8");
console.log(`Wrote ${FIXTURE_ROWS.length} rows to demo/messy-customers.csv`);
