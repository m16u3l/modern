import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getDataset,
  loadTrace,
  loadUsage,
  type TraceEntry,
} from "@/lib/persistence";

export const dynamic = "force-dynamic";

/**
 * The whole page is one server render, so the table is bounded. A 5k-row file
 * can produce thousands of findings, and shipping all of them would mean
 * megabytes of HTML for a page nobody scrolls to the end of.
 */
const TABLE_LIMIT = 250;

/**
 * Everything the pipeline did to one dataset, read straight from the tables that
 * recorded it: what was detected, what was proposed, who proposed it, and what a
 * human decided. Server-rendered on purpose — this page is a window onto the
 * database, so giving it client state would only let the two disagree.
 */
export default async function TracePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const dataset = await getDataset(id);
  if (!dataset) notFound();

  const [trace, usage] = await Promise.all([loadTrace(id), loadUsage(id)]);

  const withSuggestion = trace.filter((entry) => entry.suggestion);
  const byRule = withSuggestion.filter((e) => e.suggestion!.source === "rule");
  const decided = trace.filter((entry) => entry.decision);
  const tokens = usage.reduce(
    (total, record) => total + record.inputTokens + record.outputTokens,
    0,
  );

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
      <p className="mb-4 flex justify-end">
        <Link
          href={`/datasets/${id}`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded-md text-sm transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Review workspace
        </Link>
      </p>

      <h1 className="font-mono text-xl font-medium">{dataset.filename}</h1>
      <p className="text-muted-foreground mt-1.5 text-base text-pretty">
        Everything this dataset went through, as recorded. Uploaded{" "}
        {dataset.createdAt.toISOString().replace("T", " ").slice(0, 19)} UTC.
      </p>

      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="rows" value={dataset.rowCount.toLocaleString()} />
        <Stat label="columns" value={dataset.headers.length} />
        <Stat label="findings" value={trace.length} />
        <Stat
          label="by rules"
          value={
            withSuggestion.length === 0
              ? "—"
              : `${Math.round((byRule.length / withSuggestion.length) * 100)}%`
          }
        />
        <Stat label="decided" value={`${decided.length}/${trace.length}`} />
        <Stat label="tokens" value={tokens === 0 ? "0" : tokens.toLocaleString()} />
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-medium">Pipeline</h2>
        <div className="mt-3 grid gap-3 lg:grid-cols-4">
          <Stage
            name="1 · Parse"
            done={dataset.rowCount > 0}
            detail={
              dataset.rowCount > 0
                ? `${dataset.rowCount.toLocaleString()} rows, ${dataset.headers.length} columns in source order`
                : "not started"
            }
          />
          <Stage
            name="2 · Profile"
            done={dataset.profileCursor >= dataset.rowCount && dataset.rowCount > 0}
            detail={`${dataset.profileCursor.toLocaleString()} of ${dataset.rowCount.toLocaleString()} rows · ${trace.length} findings from deterministic rules`}
          />
          <Stage
            name="3 · Enrich"
            done={trace.every((entry) => !entry.ambiguous)}
            detail={
              usage.length === 0
                ? `${dataset.enrichCursor} escalated · no model tokens spent (stub)`
                : `${dataset.enrichCursor} escalated · ${usage.map((u) => u.model).join(", ")}`
            }
          />
          <Stage
            name="4 · Apply"
            done={decided.length > 0}
            detail={
              decided.length === 0
                ? "no decisions applied yet"
                : `${decided.length} decisions written in one transaction`
            }
          />
        </div>
      </section>

      {usage.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-medium">Model calls</h2>
          <div className="mt-3 overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">In</TableHead>
                  <TableHead className="text-right">Out</TableHead>
                  <TableHead className="text-right">Cached</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usage.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell className="font-mono text-xs">
                      {record.createdAt.toISOString().slice(11, 19)}
                    </TableCell>
                    <TableCell>{record.provider}</TableCell>
                    <TableCell className="font-mono text-xs">{record.model}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {record.inputTokens.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {record.outputTokens.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {record.cachedTokens.toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-medium">Findings ({trace.length})</h2>
        <p className="text-muted-foreground mt-1.5 max-w-3xl text-sm text-pretty">
          One row per finding, from detection to decision. A finding with no
          proposal, or a proposal with no decision, shows up as a gap rather than
          disappearing.
          {trace.length > TABLE_LIMIT && (
            <>
              {" "}
              Showing the first {TABLE_LIMIT}: the page is rendered in one pass,
              so it is capped rather than left to grow with the dataset. The
              audit export has every one of them.
            </>
          )}
        </p>

        <div className="mt-3 overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Detected</TableHead>
                <TableHead>Evidence</TableHead>
                <TableHead>Proposed</TableHead>
                <TableHead>By</TableHead>
                <TableHead className="text-right">Conf.</TableHead>
                <TableHead>Decision</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trace.slice(0, TABLE_LIMIT).map((entry) => (
                <TraceRow key={entry.issueId} entry={entry} />
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <p className="text-muted-foreground mt-8 max-w-3xl text-sm text-pretty">
        Not recorded anywhere, and therefore not shown: the raw model request and
        response, per-finding timestamps, and any review decision taken before
        Apply — the workspace keeps those in the browser until you commit them.
      </p>
    </main>
  );
}

function TraceRow({ entry }: { entry: TraceEntry }) {
  const { suggestion, decision } = entry;

  return (
    <TableRow>
      <TableCell className="align-top">
        <span className="font-medium">{entry.type.replace(/_/g, " ")}</span>
        {entry.columnKey && (
          <span className="text-muted-foreground font-mono text-xs">
            {" "}
            · {entry.columnKey}
          </span>
        )}
        <div className="text-muted-foreground mt-1 text-xs">
          row{entry.rowIndexes.length > 1 ? "s" : ""}{" "}
          {entry.rowIndexes.join(", ") || "—"} · {entry.severity}
        </div>
      </TableCell>

      <TableCell className="text-muted-foreground max-w-sm align-top text-sm whitespace-normal">
        {entry.evidence}
      </TableCell>

      <TableCell className="max-w-sm align-top whitespace-normal">
        {suggestion ? (
          <>
            <div className="font-mono text-sm">
              {suggestion.action === "delete_row" ? (
                <span>delete row</span>
              ) : suggestion.action === "no_action" ? (
                <span className="text-muted-foreground">no action</span>
              ) : (
                <>
                  <span className="text-muted-foreground line-through">
                    {display(suggestion.currentValue)}
                  </span>{" "}
                  → <span>{display(suggestion.proposedValue)}</span>
                </>
              )}
            </div>
            <div className="text-muted-foreground mt-1 text-sm">
              {suggestion.rationale}
            </div>
          </>
        ) : (
          <span className="text-muted-foreground text-sm">
            {entry.ambiguous ? "queued for the model" : "no proposal"}
          </span>
        )}
      </TableCell>

      <TableCell className="align-top">
        {suggestion && (
          <Badge variant={suggestion.source === "rule" ? "secondary" : "outline"}>
            {suggestion.source === "rule" ? "rule" : "model"}
          </Badge>
        )}
      </TableCell>

      <TableCell className="text-right align-top tabular-nums">
        {suggestion ? suggestion.confidence.toFixed(2) : "—"}
      </TableCell>

      <TableCell className="align-top">
        {decision ? (
          <>
            <Badge
              variant={
                decision.reviewStatus === "rejected" ? "ghost" : "default"
              }
            >
              {decision.reviewStatus}
            </Badge>
            <div className="text-muted-foreground mt-0.5 font-mono text-xs">
              {decision.decidedAt.toISOString().slice(11, 19)}
            </div>
            {decision.afterState && (
              <div className="mt-0.5 font-mono text-xs">
                wrote {display(Object.values(decision.afterState)[0])}
              </div>
            )}
          </>
        ) : (
          <span className="text-muted-foreground text-sm">
            {suggestion ? "pending" : "—"}
          </span>
        )}
      </TableCell>
    </TableRow>
  );
}

function display(value: string | null | undefined): string {
  if (value === null || value === undefined) return "∅";
  return value === "" ? "(empty)" : value;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-card rounded-xl border p-3.5">
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      <div className="text-muted-foreground mt-0.5 text-sm">{label}</div>
    </div>
  );
}

function Stage({
  name,
  done,
  detail,
}: {
  name: string;
  done: boolean;
  detail: string;
}) {
  return (
    <div className="bg-card rounded-xl border p-3.5">
      <div className="flex items-center gap-2">
        <span
          className={
            done
              ? "size-2 rounded-full bg-emerald-500"
              : "bg-muted-foreground/40 size-2 rounded-full"
          }
          aria-hidden
        />
        <span className="text-sm font-medium">{name}</span>
      </div>
      <p className="text-muted-foreground mt-1.5 text-sm text-pretty">{detail}</p>
    </div>
  );
}
