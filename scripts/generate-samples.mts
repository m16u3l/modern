/**
 * Builds the extra sample files in demo/ and reports what the rules engine finds
 * in each, so the numbers quoted anywhere come from a real profiling run rather
 * than from memory.
 *
 *   npx tsx scripts/generate-samples.mts
 *
 * Everything is seeded, so regenerating produces byte-identical files.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toCsv } from "../src/lib/csv";
import { profileDataset, ruleResolutionRate, splitFindings } from "../src/lib/profiling";
import type { DataRow } from "../src/lib/contracts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Mulberry32: same sequence on every machine, so the files never drift. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(random: () => number, items: T[]): T =>
  items[Math.floor(random() * items.length)];

// ---------------------------------------------------------------------------
// 1. orders-large.csv — 1,200 rows, crosses the 1,000-row chunk boundary so the
//    progress bar actually moves and the chunked pipeline is visible.
// ---------------------------------------------------------------------------

const FIRST = ["Ana", "Carlos", "Mei", "Lucía", "Omar", "Priya", "Tomás", "Grace", "Ivan", "Sofía", "Hugo", "Nadia"];
const LAST = ["Torres", "Ruiz", "Chen", "Fernández", "Haddad", "Nair", "Silva", "Kim", "Petrov", "Almeida", "Weber", "Okafor"];
const CITIES = ["Toronto", "Montreal", "Vancouver", "Calgary", "Ottawa", "Halifax"];

function ordersLarge(): { headers: string[]; rows: Array<Record<string, string>> } {
  const random = seeded(20260813);
  const headers = [
    "order_id",
    "customer_name",
    "email",
    "city",
    "ordered_at",
    "quantity",
    "unit_price",
    "status",
  ];
  const rows: Array<Record<string, string>> = [];

  for (let i = 0; i < 1_200; i++) {
    const first = pick(random, FIRST);
    const last = pick(random, LAST);
    const day = 1 + Math.floor(random() * 28);
    const month = 1 + Math.floor(random() * 12);
    const price = 12 + Math.floor(random() * 480) + random();

    // Most rows are clean; the messiness is seeded at realistic rates rather
    // than sprinkled everywhere, which is what makes the rule/model split
    // meaningful instead of a demo trick.
    const roll = random();

    rows.push({
      order_id: String(90_000 + i),
      customer_name:
        roll < 0.04 ? `${first} ${last}`.toUpperCase() : `${first} ${last}`,
      email:
        roll < 0.02
          ? ""
          : roll < 0.05
            ? `${first}.${last}@example` // truncated domain — needs judgement
            : `${first}.${last}@example.com`.toLowerCase(),
      city: roll < 0.06 ? pick(random, CITIES).toLowerCase() : pick(random, CITIES),
      ordered_at:
        roll < 0.08
          ? `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/2025` // slash format
          : `2025-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      quantity: roll < 0.03 ? "N/A" : String(1 + Math.floor(random() * 6)),
      unit_price:
        roll < 0.04
          ? `CAD ${price.toFixed(2)}`
          : roll < 0.045
            ? String(Math.round(price * 900)) // outlier
            : price.toFixed(2),
      status: roll < 0.05 ? pick(random, ["ACTIVE", "Shipped", "shipped "]) : pick(random, ["shipped", "pending", "cancelled"]),
    });
  }

  // A handful of exact and near duplicates, placed by hand so they are findable
  // during a demo rather than buried at random.
  rows.push({ ...rows[3] });
  rows.push({ ...rows[57] });
  rows.push({ ...rows[811], order_id: String(90_000 + 1_202) });
  rows.push({
    ...rows[402],
    order_id: String(90_000 + 1_203),
    customer_name: rows[402].customer_name.replace("í", "i"),
  });

  return { headers, rows };
}

// ---------------------------------------------------------------------------
// 2. products-inventory.csv — a different domain, to show nothing here is tuned
//    to customer records.
// ---------------------------------------------------------------------------

const CATEGORIES = ["Kitchen", "Outdoor", "Office", "Lighting"];
const MATERIALS = ["oak", "steel", "linen", "ceramic", "walnut"];

function productsInventory(): { headers: string[]; rows: Array<Record<string, string>> } {
  const random = seeded(778);
  const headers = ["sku", "name", "category", "price_cad", "stock", "restocked_on", "discontinued"];
  const rows: Array<Record<string, string>> = [];

  for (let i = 0; i < 140; i++) {
    const material = pick(random, MATERIALS);
    const roll = random();
    const price = 9 + random() * 300;

    rows.push({
      sku: `SKU-${String(1000 + i)}`,
      name: `${material} ${pick(random, ["bowl", "lamp", "chair", "tray", "shelf"])}`,
      category: roll < 0.07 ? pick(random, CATEGORIES).toUpperCase() : pick(random, CATEGORIES),
      price_cad:
        roll < 0.05
          ? `$${price.toFixed(2)}`
          : roll < 0.07
            ? "-1"                       // a negative price: suspicious, not just odd
            : price.toFixed(2),
      stock: roll < 0.04 ? "unknown" : String(Math.floor(random() * 220)),
      restocked_on:
        roll < 0.06
          ? `${1 + Math.floor(random() * 12)}/${1 + Math.floor(random() * 28)}/2025`
          : `2025-0${1 + Math.floor(random() * 8)}-1${Math.floor(random() * 9)}`,
      discontinued: roll < 0.05 ? pick(random, ["Y", "TRUE", "1"]) : pick(random, ["true", "false"]),
    });
  }

  rows.push({ ...rows[11] });
  rows.push({ ...rows[64], sku: "SKU-1064 " });

  return { headers, rows };
}

// ---------------------------------------------------------------------------
// 3. header-edge-cases.csv — small, but every value is a parser trap: duplicate
//    header names, a blank one, quoted commas, accents, padded cells.
// ---------------------------------------------------------------------------

function headerEdgeCases(): { headers: string[]; rows: Array<Record<string, string>> } {
  // Written as raw text further down; the shape is declared here for profiling.
  const headers = ["email", "email_2", "column_3", "full_name", "note", "amount"];
  const rows = [
    { email: "ana@example.com", email_2: "ana.torres@work.example.com", column_3: "1", full_name: "Torres, Ana", note: "called twice; no answer", amount: "1,240.50" },
    { email: "carlos@example.com", email_2: "", column_3: "2", full_name: "Ruiz  Carlos", note: "", amount: "890" },
    { email: "mei@example,com", email_2: "mei@example.com", column_3: "3", full_name: "Chen, Mei", note: 'said "call back Friday"', amount: "USD 2,050.00" },
    { email: "lucía@example.com", email_2: "lucia@example.com", column_3: "4", full_name: "Fernández, Lucía", note: "prefers email", amount: "-45.00" },
    { email: "", email_2: "omar@example.com", column_3: "5", full_name: "Haddad, Omar", note: "N/A", amount: "0" },
    { email: "ana@example.com", email_2: "ana.torres@work.example.com", column_3: "6", full_name: "Torres, Ana", note: "called twice; no answer", amount: "1,240.50" },
  ];

  return { headers, rows };
}

/** The raw text, because the point of this file is what the parser does to it. */
const HEADER_EDGE_CASES_RAW = `email,email,,full_name,note,amount
ana@example.com,ana.torres@work.example.com,1,"Torres, Ana",called twice; no answer,"1,240.50"
carlos@example.com,,2,Ruiz  Carlos,, 890
"mei@example,com",mei@example.com,3,"Chen, Mei","said ""call back Friday""","USD 2,050.00"
lucía@example.com,lucia@example.com,4,"Fernández, Lucía",prefers email,-45.00
,omar@example.com,5,"Haddad, Omar",N/A,0
ana@example.com,ana.torres@work.example.com,6,"Torres, Ana",called twice; no answer,"1,240.50"
`;

// ---------------------------------------------------------------------------
// 4. clean-contacts.csv — nothing wrong with it. Proves the tool does not invent
//    problems, and exercises the empty state.
// ---------------------------------------------------------------------------

function cleanContacts(): { headers: string[]; rows: Array<Record<string, string>> } {
  const random = seeded(4242);
  const headers = ["contact_id", "full_name", "email", "phone", "joined_on", "country"];
  const rows: Array<Record<string, string>> = [];
  const used = new Set<string>();

  for (let i = 0; i < 60; i++) {
    let first = pick(random, FIRST);
    let last = pick(random, LAST);
    while (used.has(`${first} ${last}`)) {
      first = pick(random, FIRST);
      last = pick(random, LAST);
    }
    used.add(`${first} ${last}`);

    rows.push({
      contact_id: String(5000 + i),
      full_name: `${first} ${last}`,
      email: `${first}.${last}@example.com`.toLowerCase(),
      phone: `(555) ${String(100 + Math.floor(random() * 800))}-${String(1000 + Math.floor(random() * 8999))}`,
      joined_on: `2025-0${1 + Math.floor(random() * 8)}-${String(1 + Math.floor(random() * 27)).padStart(2, "0")}`,
      country: pick(random, ["Canada", "Mexico", "Spain", "Brazil"]),
    });
  }

  return { headers, rows };
}

// ---------------------------------------------------------------------------

const samples = [
  { file: "orders-large.csv", note: "1,200 rows — crosses the chunk boundary", build: ordersLarge },
  { file: "products-inventory.csv", note: "different domain", build: productsInventory },
  { file: "header-edge-cases.csv", note: "parser traps", build: headerEdgeCases, raw: HEADER_EDGE_CASES_RAW },
  { file: "clean-contacts.csv", note: "nothing to find", build: cleanContacts },
];

for (const sample of samples) {
  const { headers, rows } = sample.build();
  const text = sample.raw ?? toCsv(headers, rows) + "\n";
  writeFileSync(path.join(root, "demo", sample.file), text, "utf8");

  const dataRows: DataRow[] = rows.map((data, index) => ({
    id: `r-${index}`,
    rowIndex: index,
    data,
  }));
  const { findings } = profileDataset(dataRows, headers);
  const { ambiguous } = splitFindings(findings);

  const byType = findings.reduce<Record<string, number>>((acc, finding) => {
    acc[finding.issue.type] = (acc[finding.issue.type] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`\n${sample.file}  (${sample.note})`);
  console.log(`  ${rows.length} rows · ${headers.length} columns · ${findings.length} findings`);
  console.log(
    `  ${Math.round(ruleResolutionRate(findings) * 100)}% resolved by rules · ${ambiguous.length} escalated to the model`,
  );
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type.padEnd(20)} ${count}`);
  }
}
