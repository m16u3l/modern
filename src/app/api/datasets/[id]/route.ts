import {
  buildSummary,
  loadIssues,
  loadRows,
  loadSuggestions,
  ruleShare,
} from "@/lib/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Everything the review workspace needs in one round trip. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const summary = await buildSummary(id);
  if (!summary) return Response.json({ error: "Unknown dataset" }, { status: 404 });

  const [rows, issues, suggestions, share] = await Promise.all([
    loadRows(id),
    loadIssues(id),
    loadSuggestions(id),
    ruleShare(id),
  ]);

  return Response.json({ summary, rows, issues, suggestions, ruleShare: share });
}
