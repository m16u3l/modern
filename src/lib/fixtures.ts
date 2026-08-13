import {
  groupKeyFor,
  type ColumnProfile,
  type DataRow,
  type DatasetSummary,
  type DetectedBy,
  type Issue,
  type IssueType,
  type Severity,
  type Suggestion,
  type SuggestionAction,
  ISSUE_TYPES,
} from "./contracts";

/**
 * A hand-seeded messy customer table plus the issues a real run would find on
 * it. The review workspace is built and demoed against this before any backend
 * exists, and the same data seeds `demo/messy-customers.csv`.
 */

export const FIXTURE_DATASET_ID = "demo-dataset";

const HEADERS = [
  "customer_id",
  "full_name",
  "email",
  "phone",
  "signup_date",
  "country",
  "revenue",
  "status",
] as const;

// Defects seeded on purpose: duplicate rows (exact and near), three phone
// shapes, two date formats, casing drift on country/status, disguised nulls
// ("N/A", "-", "unknown"), broken emails, non-numeric revenue and outliers.
const RAW_ROWS: string[][] = [
  ["1001", "Ana María Torres", "ana.torres@example.com", "(555) 010-2233", "2024-01-05", "Mexico", "1240.50", "active"],
  ["1002", "Carlos Ruiz", "carlos.ruiz@example.com", "555-010-4411", "2024-02-05", "mexico", "890.00", "active"],
  ["1003", "Carlos Ruíz", "carlos.ruiz@example.com", "5550104411", "05/02/2024", "Mexico", "890.00", "active"],
  ["1004", "Lucía Fernández", "lucia.fernandez@example", "+52 555 010 8899", "2024-02-14", "Spain", "2100.75", "active"],
  ["1005", "John Smith", "john.smith@example.com", "555.010.7788", "2024-03-01", "USA", "N/A", "active"],
  ["1005", "John Smith", "john.smith@example.com", "555.010.7788", "2024-03-01", "USA", "N/A", "active"],
  ["1007", "Priya Nair", "priya.nair@example.com", "(555) 010-3344", "2024-03-11", "India", "3420.00", "active"],
  ["1008", "priya nair", "priya.nair@exmaple.com", "555 010 3344", "11/03/2024", "india", "3420.00", "active"],
  ["1009", "Tomás Álvarez", "tomas.alvarez@example.com", "(555) 010-9911", "2024-04-02", "Argentina", "-450.00", "active"],
  ["1010", "Mei Chen", "mei.chen@example.com", "", "2024-04-18", "China", "1875.25", "active"],
  ["1011", "Ahmed Hassan", "ahmed.hassan@example.com", "(555) 010-5566", "2024-05-07", "Egypt", "980000.00", "active"],
  ["1012", "Sofia Rossi", "", "(555) 010-2277", "2024-05-21", "Italy", "1560.00", "active"],
  ["1013", "Test User", "test@test.com", "(000) 000-0000", "2024-06-01", "unknown", "0.00", "active"],
  ["1014", "Marta Nowak", "marta.nowak@example.com", "+48 555 010 6677", "06/15/2024", "Poland", "2340.10", "ACTIVE"],
  ["1015", "Marta Novak", "marta.nowak@example.com", "+48 555 010 6677", "2024-06-15", "Poland", "2340.10", "active"],
  ["1016", "Kenji Tanaka", "kenji.tanaka@example.com", "(555) 010-8822", "2024-07-03", "Japan", "4120,00", "active"],
  ["1017", "Olivia Brown", "olivia.brown@example,com", "(555) 010-4499", "2024-07-19", "UK", "1720.00", "active"],
  ["1018", "Diego Morales", "diego.morales@example.com", "(555) 010-1122", "2024-08-08", "Chile", "-", "active"],
  ["1019", "Elena Petrova", "elena.petrova@example.com", "(555) 010-6633", "2024-08-25", "Russia", "2890.40", "Active"],
  ["1020", "Sam O'Neill", "sam.oneill@example.com", "(555) 010-7744", "2024-09-09", "Ireland", "1130.90", "active"],
  ["1021", "Sam ONeill", "sam.oneill@example.com", "5550107744", "09/09/2024", "ireland", "1130.90", "active"],
  ["1022", "Fatima Zahra", "fatima.zahra@example.com", "(555) 010-9955", "2024-09-30", "Morocco", "unknown", "active"],
  ["1023", "Lars Andersen", "lars.andersen@example.com", "(555) 010-3311", "2024-10-12", "Denmark", "USD 2050.00", "active"],
  ["1024", "N/A", "", "(555) 010-1199", "2024-10-28", "Brazil", "760.00", "active"],
  ["1025", "Yuki Sato", "yuki.sato@example.com", "(555) 010-2244", "2024-11-05", "Japan", "1990.00", "active"],
  ["1026", "Hans Müller", "hans.mueller@example.com", "+49 555 010 5533", "11/20/2024", "Germany", "3310.60", "active"],
  ["1027", "Amara Okafor", "amara.okafor@example.com", "(555) 010-8877", "2024-12-02", "Nigeria", "abc", "active"],
  ["1028", "Isabella Silva", "isabella.silva@example.com", "(555) 010-2255", "2024-12-18", "Brazil", "2470.30", "active"],
  ["1029", "Isabela Silva", "isabella.silva@example.com", "(555) 010-2255", "2024-12-18", "brazil", "2470.30", "active"],
  ["1030", "Chen Wei", "chen.wei@example.com", "(555) 010-6644", "2025-01-13", "China", "1420.00", "active"],
  ["1031", "Nadia Haddad", "nadia.haddad@example.com", "(555) 010-9933", "2025-01-22", "Lebanon", "1,680.50", "active"],
  ["1032", "Peter Novak", "peter.novak@example", "(555) 010-4422", "2025-02-08", "Slovakia", "2230.00", "active"],
  ["1033", "Grace Kim", "grace.kim@example.com", "(555) 010-7733", "2025-02-25", "Korea", "0", "active"],
  ["1033", "Grace Kim", "grace.kim@example.com", "(555) 010-7733", "2025-02-25", "Korea", "0", "active"],
  ["1035", "Ravi Patel", "ravi.patel@example.com", "(555) 010-3355", "2025-03-05", "India", "1450.00", "active"],
  ["1035", "Ravi Patel", "ravi.patel@example.com", "(555) 010-3355", "2025-03-05", "India", "1450.00", "active"],
  ["1037", "Clara Dubois", "clara.dubois@example.com", "(555) 010-8811", "2025-03-19", "France", "2680.00", "active"],
  ["1037", "Clara Dubois", "clara.dubois@example.com", "(555) 010-8811", "2025-03-19", "France", "2680.00", "active"],
  ["1039", "Ana Maria Torres", "ana.torres@example.com", "(555) 010-2233", "2024-01-05", "Mexico", "1240.50", "active"],
  ["1040", "Ingrid Larsen", "ingrid.larsen@example.com", "(555) 010-5599", "2025-04-02", "Norway", "3050.00", "active"],
];

function rowId(index: number): string {
  return `r-${String(index + 1).padStart(2, "0")}`;
}

export const FIXTURE_ROWS: DataRow[] = RAW_ROWS.map((cells, index) => ({
  id: rowId(index),
  rowIndex: index,
  data: Object.fromEntries(HEADERS.map((header, i) => [header, cells[i]])),
}));

const ROWS_BY_ID = new Map(FIXTURE_ROWS.map((row) => [row.id, row]));

export function fixtureRow(id: string): DataRow | undefined {
  return ROWS_BY_ID.get(id);
}

function cell(id: string, columnKey: string): string | null {
  const value = ROWS_BY_ID.get(id)?.data[columnKey];
  return value === undefined || value === "" ? null : value;
}

export const FIXTURE_COLUMNS: ColumnProfile[] = [
  { key: "customer_id", inferredType: "number", nullCount: 0, distinctCount: 37, sampleValues: ["1001", "1002", "1003"] },
  { key: "full_name", inferredType: "string", nullCount: 0, distinctCount: 36, sampleValues: ["Ana María Torres", "Carlos Ruiz", "Mei Chen"] },
  { key: "email", inferredType: "email", nullCount: 2, distinctCount: 34, sampleValues: ["ana.torres@example.com", "lucia.fernandez@example", "olivia.brown@example,com"] },
  { key: "phone", inferredType: "phone", nullCount: 1, distinctCount: 36, sampleValues: ["(555) 010-2233", "555-010-4411", "+52 555 010 8899"] },
  { key: "signup_date", inferredType: "date", nullCount: 0, distinctCount: 36, sampleValues: ["2024-01-05", "05/02/2024", "11/20/2024"] },
  { key: "country", inferredType: "string", nullCount: 0, distinctCount: 27, sampleValues: ["Mexico", "mexico", "unknown"] },
  { key: "revenue", inferredType: "number", nullCount: 0, distinctCount: 33, sampleValues: ["1240.50", "N/A", "USD 2050.00"] },
  { key: "status", inferredType: "string", nullCount: 0, distinctCount: 3, sampleValues: ["active", "ACTIVE", "Active"] },
];

type FixtureSpec = {
  type: IssueType;
  severity: Severity;
  columnKey?: string;
  rowId: string;
  /** Other rows involved — the survivors of a duplicate group, for instance. */
  relatedRowIds?: string[];
  evidence: string;
  action: SuggestionAction;
  /** Only needed when the value cannot be read off the row (deletes, merges). */
  currentValue?: string | null;
  proposedValue: string | null;
  confidence: number;
  rationale: string;
  source: DetectedBy;
};

const SPECS: FixtureSpec[] = [
  // --- inconsistent_format · phone (majority shape is "(555) 010-XXXX") ---
  { type: "inconsistent_format", severity: "low", columnKey: "phone", rowId: "r-02", evidence: '34 of 40 phones use "(NNN) NNN-NNNN"; this row uses "NNN-NNN-NNNN".', action: "normalize_value", proposedValue: "(555) 010-4411", confidence: 0.96, rationale: "Same digits, different separators. Reformatted to the dominant shape.", source: "rule" },
  { type: "inconsistent_format", severity: "low", columnKey: "phone", rowId: "r-03", evidence: "Digits only, no separators.", action: "normalize_value", proposedValue: "(555) 010-4411", confidence: 0.96, rationale: "Same digits, different separators. Reformatted to the dominant shape.", source: "rule" },
  { type: "inconsistent_format", severity: "low", columnKey: "phone", rowId: "r-05", evidence: 'Dot-separated "NNN.NNN.NNNN".', action: "normalize_value", proposedValue: "(555) 010-7788", confidence: 0.96, rationale: "Same digits, different separators. Reformatted to the dominant shape.", source: "rule" },
  { type: "inconsistent_format", severity: "low", columnKey: "phone", rowId: "r-08", evidence: "Space-separated digits.", action: "normalize_value", proposedValue: "(555) 010-3344", confidence: 0.96, rationale: "Same digits, different separators. Reformatted to the dominant shape.", source: "rule" },
  { type: "inconsistent_format", severity: "low", columnKey: "phone", rowId: "r-21", evidence: "Digits only, no separators.", action: "normalize_value", proposedValue: "(555) 010-7744", confidence: 0.96, rationale: "Same digits, different separators. Reformatted to the dominant shape.", source: "rule" },

  // --- inconsistent_format · signup_date (majority is ISO 8601) ---
  { type: "inconsistent_format", severity: "medium", columnKey: "signup_date", rowId: "r-03", evidence: "35 of 40 dates are ISO (YYYY-MM-DD); this one is DD/MM/YYYY.", action: "normalize_value", proposedValue: "2024-02-05", confidence: 0.82, rationale: 'Day 05 / month 02 read from the duplicate of this row, which stores "2024-02-05".', source: "rule" },
  { type: "inconsistent_format", severity: "medium", columnKey: "signup_date", rowId: "r-08", evidence: "Non-ISO date format.", action: "normalize_value", proposedValue: "2024-03-11", confidence: 0.80, rationale: 'Resolved as DD/MM/YYYY using the near-duplicate row, which stores "2024-03-11".', source: "rule" },
  { type: "inconsistent_format", severity: "medium", columnKey: "signup_date", rowId: "r-14", evidence: "Non-ISO date format.", action: "normalize_value", proposedValue: "2024-06-15", confidence: 0.91, rationale: "Month 06 / day 15 — unambiguous because 15 cannot be a month.", source: "rule" },
  { type: "inconsistent_format", severity: "medium", columnKey: "signup_date", rowId: "r-26", evidence: "Non-ISO date format.", action: "normalize_value", proposedValue: "2024-11-20", confidence: 0.91, rationale: "Month 11 / day 20 — unambiguous because 20 cannot be a month.", source: "rule" },

  // --- inconsistent_format · country (casing drift) ---
  { type: "inconsistent_format", severity: "low", columnKey: "country", rowId: "r-02", evidence: '"Mexico" appears 3 times capitalised, once lowercase.', action: "normalize_value", proposedValue: "Mexico", confidence: 0.94, rationale: "Casing normalised to the dominant spelling of the same country.", source: "rule" },
  { type: "inconsistent_format", severity: "low", columnKey: "country", rowId: "r-08", evidence: '"India" appears capitalised elsewhere.', action: "normalize_value", proposedValue: "India", confidence: 0.94, rationale: "Casing normalised to the dominant spelling of the same country.", source: "rule" },
  { type: "inconsistent_format", severity: "low", columnKey: "country", rowId: "r-21", evidence: '"Ireland" appears capitalised elsewhere.', action: "normalize_value", proposedValue: "Ireland", confidence: 0.94, rationale: "Casing normalised to the dominant spelling of the same country.", source: "rule" },
  { type: "inconsistent_format", severity: "low", columnKey: "country", rowId: "r-29", evidence: '"Brazil" appears capitalised elsewhere.', action: "normalize_value", proposedValue: "Brazil", confidence: 0.94, rationale: "Casing normalised to the dominant spelling of the same country.", source: "rule" },

  // --- inconsistent_format · status (casing drift) ---
  { type: "inconsistent_format", severity: "low", columnKey: "status", rowId: "r-14", evidence: '38 of 40 rows use "active"; 2 use other casings.', action: "normalize_value", proposedValue: "active", confidence: 0.97, rationale: "Lowercased to match the dominant value of an enum-like column.", source: "rule" },
  { type: "inconsistent_format", severity: "low", columnKey: "status", rowId: "r-19", evidence: '38 of 40 rows use "active"; 2 use other casings.', action: "normalize_value", proposedValue: "active", confidence: 0.97, rationale: "Lowercased to match the dominant value of an enum-like column.", source: "rule" },

  // --- missing_value · revenue (disguised nulls) ---
  { type: "missing_value", severity: "medium", columnKey: "revenue", rowId: "r-05", evidence: '"N/A" is a disguised null in a numeric column.', action: "set_value", proposedValue: null, confidence: 0.93, rationale: 'Replaced the placeholder with a real null so aggregations stop counting "N/A" as a category.', source: "rule" },
  { type: "missing_value", severity: "medium", columnKey: "revenue", rowId: "r-06", evidence: '"N/A" is a disguised null in a numeric column.', action: "set_value", proposedValue: null, confidence: 0.93, rationale: 'Replaced the placeholder with a real null so aggregations stop counting "N/A" as a category.', source: "rule" },
  { type: "missing_value", severity: "medium", columnKey: "revenue", rowId: "r-18", evidence: '"-" is a disguised null in a numeric column.', action: "set_value", proposedValue: null, confidence: 0.88, rationale: "Replaced the placeholder with a real null.", source: "rule" },
  { type: "missing_value", severity: "medium", columnKey: "revenue", rowId: "r-22", evidence: '"unknown" is a disguised null in a numeric column.', action: "set_value", proposedValue: null, confidence: 0.90, rationale: "Replaced the placeholder with a real null.", source: "rule" },

  // --- missing_value · email / phone / country ---
  { type: "missing_value", severity: "high", columnKey: "email", rowId: "r-12", evidence: "Empty email on an otherwise complete row.", action: "no_action", currentValue: null, proposedValue: null, confidence: 0.31, rationale: "No reliable way to recover an email address from the remaining columns. Flagged for manual follow-up rather than guessed.", source: "llm" },
  { type: "missing_value", severity: "high", columnKey: "email", rowId: "r-24", evidence: "Empty email on a row whose name is also a placeholder.", action: "delete_row", currentValue: null, proposedValue: null, confidence: 0.64, rationale: "Both the identifying name and the email are absent, so the record cannot be matched to a real customer.", source: "llm" },
  { type: "missing_value", severity: "low", columnKey: "phone", rowId: "r-10", evidence: "Empty phone.", action: "no_action", currentValue: null, proposedValue: null, confidence: 0.28, rationale: "A phone number cannot be inferred from other fields. Left untouched on purpose.", source: "llm" },
  { type: "missing_value", severity: "medium", columnKey: "country", rowId: "r-13", evidence: '"unknown" is a disguised null.', action: "set_value", proposedValue: null, confidence: 0.86, rationale: "Replaced the placeholder with a real null.", source: "rule" },

  // --- exact_duplicate ---
  { type: "exact_duplicate", severity: "high", rowId: "r-06", relatedRowIds: ["r-05"], evidence: "Byte-identical to row 5 across all 8 columns.", action: "delete_row", currentValue: null, proposedValue: null, confidence: 0.99, rationale: "Identical hash of the normalised row. Keeping the first occurrence.", source: "rule" },
  { type: "exact_duplicate", severity: "high", rowId: "r-34", relatedRowIds: ["r-33"], evidence: "Byte-identical to row 33 across all 8 columns.", action: "delete_row", currentValue: null, proposedValue: null, confidence: 0.99, rationale: "Identical hash of the normalised row. Keeping the first occurrence.", source: "rule" },
  { type: "exact_duplicate", severity: "high", rowId: "r-36", relatedRowIds: ["r-35"], evidence: "Byte-identical to row 35 across all 8 columns.", action: "delete_row", currentValue: null, proposedValue: null, confidence: 0.99, rationale: "Identical hash of the normalised row. Keeping the first occurrence.", source: "rule" },
  { type: "exact_duplicate", severity: "high", rowId: "r-38", relatedRowIds: ["r-37"], evidence: "Byte-identical to row 37 across all 8 columns.", action: "delete_row", currentValue: null, proposedValue: null, confidence: 0.99, rationale: "Identical hash of the normalised row. Keeping the first occurrence.", source: "rule" },

  // --- fuzzy_duplicate (the LLM's main job: same person or two people?) ---
  { type: "fuzzy_duplicate", severity: "high", rowId: "r-39", relatedRowIds: ["r-01"], evidence: 'Same email, phone, signup date and revenue as row 1; name differs only by accents ("Ana María" vs "Ana Maria").', action: "delete_row", currentValue: null, proposedValue: null, confidence: 0.95, rationale: "Every identifying field matches exactly; the name differs only in diacritics. Same customer entered twice.", source: "llm" },
  { type: "fuzzy_duplicate", severity: "high", rowId: "r-03", relatedRowIds: ["r-02"], evidence: 'Same email and revenue as row 2; name differs by one accent ("Ruiz" vs "Ruíz").', action: "delete_row", currentValue: null, proposedValue: null, confidence: 0.89, rationale: "Shared email address plus identical revenue. The differing phone and date formats are the same values written differently.", source: "llm" },
  { type: "fuzzy_duplicate", severity: "high", rowId: "r-08", relatedRowIds: ["r-07"], evidence: "Same phone and revenue as row 7; email domain differs by a transposition.", action: "delete_row", currentValue: null, proposedValue: null, confidence: 0.87, rationale: '"exmaple.com" is a keyboard transposition of "example.com". Same phone number and revenue confirm it is one customer.', source: "llm" },
  { type: "fuzzy_duplicate", severity: "medium", rowId: "r-21", relatedRowIds: ["r-20"], evidence: "Same email, phone and revenue as row 20; name differs by an apostrophe.", action: "delete_row", currentValue: null, proposedValue: null, confidence: 0.92, rationale: '"ONeill" is "O\'Neill" with the apostrophe stripped. All other identifying fields match.', source: "llm" },
  { type: "fuzzy_duplicate", severity: "medium", rowId: "r-29", relatedRowIds: ["r-28"], evidence: 'Same email, phone and revenue as row 28; name differs by one letter ("Isabella" vs "Isabela").', action: "delete_row", currentValue: null, proposedValue: null, confidence: 0.68, rationale: "Strong field overlap, but a one-letter name difference can also be two siblings sharing a household record. Below the bulk-accept threshold on purpose.", source: "llm" },
  { type: "fuzzy_duplicate", severity: "medium", rowId: "r-15", relatedRowIds: ["r-14"], evidence: 'Same email, phone and revenue as row 14; surname differs ("Nowak" vs "Novak").', action: "delete_row", currentValue: null, proposedValue: null, confidence: 0.66, rationale: "Nowak and Novak are distinct, common Polish surnames. The shared email is suggestive but not conclusive — needs a human.", source: "llm" },

  // --- suspicious_value · email ---
  { type: "suspicious_value", severity: "high", columnKey: "email", rowId: "r-17", evidence: "Comma where the TLD separator should be.", action: "set_value", proposedValue: "olivia.brown@example.com", confidence: 0.96, rationale: "A comma sits next to the period on the keyboard and no TLD is named \",com\".", source: "llm" },
  { type: "suspicious_value", severity: "high", columnKey: "email", rowId: "r-04", evidence: "Domain has no TLD.", action: "set_value", proposedValue: "lucia.fernandez@example.com", confidence: 0.77, rationale: 'Every other address in the column uses "example.com". Likely a truncated paste.', source: "llm" },
  { type: "suspicious_value", severity: "high", columnKey: "email", rowId: "r-32", evidence: "Domain has no TLD.", action: "set_value", proposedValue: "peter.novak@example.com", confidence: 0.77, rationale: 'Every other address in the column uses "example.com". Likely a truncated paste.', source: "llm" },
  { type: "suspicious_value", severity: "medium", columnKey: "email", rowId: "r-08", evidence: 'Domain "exmaple.com" is a near-miss of the dominant domain.', action: "set_value", proposedValue: "priya.nair@example.com", confidence: 0.84, rationale: "Single-character transposition of a domain used by 36 other rows.", source: "llm" },

  // --- suspicious_value · full_name (placeholders) ---
  { type: "suspicious_value", severity: "high", columnKey: "full_name", rowId: "r-13", evidence: 'Name "Test User" with email "test@test.com" and an all-zero phone.', action: "delete_row", currentValue: null, proposedValue: null, confidence: 0.73, rationale: "Three independent placeholder signals on the same row. Almost certainly a test record that leaked into production.", source: "llm" },
  { type: "suspicious_value", severity: "medium", columnKey: "full_name", rowId: "r-24", evidence: '"N/A" used as a person\'s name.', action: "set_value", proposedValue: null, confidence: 0.81, rationale: "A placeholder string in a name column is a null, not a name.", source: "llm" },

  // --- type_mismatch · revenue ---
  { type: "type_mismatch", severity: "medium", columnKey: "revenue", rowId: "r-16", evidence: "Comma used as the decimal separator in a column inferred as number.", action: "normalize_value", proposedValue: "4120.00", confidence: 0.90, rationale: "European decimal notation. Converted to the dot notation used by the other 36 numeric values.", source: "rule" },
  { type: "type_mismatch", severity: "medium", columnKey: "revenue", rowId: "r-23", evidence: "Currency prefix inside a numeric column.", action: "normalize_value", proposedValue: "2050.00", confidence: 0.94, rationale: 'Stripped the "USD " prefix; the currency belongs in its own column, not in the value.', source: "rule" },
  { type: "type_mismatch", severity: "medium", columnKey: "revenue", rowId: "r-31", evidence: "Thousands separator inside a numeric column.", action: "normalize_value", proposedValue: "1680.50", confidence: 0.92, rationale: "Removed the thousands comma so the value parses as a number.", source: "rule" },
  { type: "type_mismatch", severity: "high", columnKey: "revenue", rowId: "r-27", evidence: '"abc" cannot be parsed as a number.', action: "no_action", proposedValue: null, confidence: 0.42, rationale: "The value carries no recoverable numeric signal. Deleting it would silently lose information, so it is surfaced for a human instead.", source: "llm" },

  // --- outlier · revenue (IQR) ---
  { type: "outlier", severity: "high", columnKey: "revenue", rowId: "r-11", evidence: "980000.00 is 412× the interquartile range above Q3.", action: "no_action", proposedValue: null, confidence: 0.91, rationale: "Statistically extreme, but a genuine enterprise account looks exactly like this. Flagged, never auto-corrected.", source: "rule" },
  { type: "outlier", severity: "medium", columnKey: "revenue", rowId: "r-09", evidence: "Negative value in a revenue column.", action: "no_action", proposedValue: null, confidence: 0.74, rationale: "Could be a legitimate refund or a sign error. Needs domain knowledge this tool does not have.", source: "rule" },
  { type: "outlier", severity: "low", columnKey: "revenue", rowId: "r-13", evidence: "0.00 sits below the lower IQR fence.", action: "no_action", proposedValue: null, confidence: 0.55, rationale: "Zero revenue is plausible for a new account, so this is informational only.", source: "rule" },
  { type: "outlier", severity: "low", columnKey: "revenue", rowId: "r-33", evidence: "0 sits below the lower IQR fence.", action: "no_action", proposedValue: null, confidence: 0.55, rationale: "Zero revenue is plausible for a new account, so this is informational only.", source: "rule" },
];

function buildFixtures(): { issues: Issue[]; suggestions: Suggestion[] } {
  const issues: Issue[] = [];
  const suggestions: Suggestion[] = [];

  SPECS.forEach((spec, index) => {
    const seq = String(index + 1).padStart(3, "0");
    const issueId = `iss-${seq}`;

    issues.push({
      id: issueId,
      datasetId: FIXTURE_DATASET_ID,
      type: spec.type,
      severity: spec.severity,
      columnKey: spec.columnKey,
      rowIds: [spec.rowId, ...(spec.relatedRowIds ?? [])],
      detectedBy: spec.source,
      evidence: spec.evidence,
    });

    suggestions.push({
      id: `sug-${seq}`,
      issueId,
      datasetId: FIXTURE_DATASET_ID,
      action: spec.action,
      rowId: spec.rowId,
      columnKey: spec.columnKey,
      currentValue:
        spec.currentValue !== undefined
          ? spec.currentValue
          : spec.columnKey
            ? cell(spec.rowId, spec.columnKey)
            : null,
      proposedValue: spec.proposedValue,
      confidence: spec.confidence,
      rationale: spec.rationale,
      source: spec.source,
      groupKey: groupKeyFor(spec.type, spec.columnKey),
    });
  });

  return { issues, suggestions };
}

const built = buildFixtures();

export const FIXTURE_ISSUES: Issue[] = built.issues;
export const FIXTURE_SUGGESTIONS: Suggestion[] = built.suggestions;

function countByType(): Record<IssueType, number> {
  const counts = Object.fromEntries(
    ISSUE_TYPES.map((type) => [type, 0]),
  ) as Record<IssueType, number>;
  for (const issue of FIXTURE_ISSUES) counts[issue.type] += 1;
  return counts;
}

function computeCompleteness(): number {
  const total = FIXTURE_ROWS.length * FIXTURE_COLUMNS.length;
  const missing = FIXTURE_ROWS.reduce(
    (acc, row) =>
      acc +
      Object.values(row.data).filter(
        (value) => value === "" || value === "N/A" || value === "-" || value === "unknown",
      ).length,
    0,
  );
  return Number(((total - missing) / total).toFixed(4));
}

export const FIXTURE_SUMMARY: DatasetSummary = {
  id: FIXTURE_DATASET_ID,
  filename: "messy-customers.csv",
  rowCount: FIXTURE_ROWS.length,
  columns: FIXTURE_COLUMNS,
  issueCounts: countByType(),
  completeness: computeCompleteness(),
  status: "ready",
  progress: 1,
};
