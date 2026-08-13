"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import { Loader2, Sparkles, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MAX_DEMO_ROWS } from "@/lib/contracts";

export function UploadPanel() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | "demo" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function startDemo() {
    setBusy("demo");
    setError(null);
    try {
      const response = await fetch("/api/demo", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not load the demo");
      router.push(`/datasets/${body.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the demo");
      setBusy(null);
    }
  }

  async function handleFile(file: File) {
    setBusy("upload");
    setError(null);
    try {
      // Straight from the browser to blob storage — the file never passes
      // through a serverless function, so the 4.5 MB body limit does not apply.
      const blob = await upload(file.name, file, {
        access: "private",
        handleUploadUrl: "/api/upload",
        contentType: file.type || "text/csv",
      });

      const response = await fetch("/api/datasets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, blobUrl: blob.url }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not register the file");

      router.push(`/datasets/${body.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload failed");
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* A file target you can drop onto, rather than a button you must find.
          The click handler stays on the button so the whole card is not one
          giant hit area competing with "Load demo data". */}
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (busy === null) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (busy !== null) return;
          const file = event.dataTransfer.files?.[0];
          if (file) void handleFile(file);
        }}
        className={cn(
          "bg-card flex flex-col items-center gap-4 rounded-xl border border-dashed px-4 py-8 text-center sm:px-6 sm:py-10 transition-colors",
          dragging && "border-primary/70 bg-accent/50",
        )}
      >
        <p className="font-medium">
          {busy === "upload"
            ? "Uploading…"
            : dragging
              ? "Drop it to start"
              : "Drop a CSV here"}
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button onClick={startDemo} disabled={busy !== null}>
            {busy === "demo" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="size-4" aria-hidden />
            )}
            {busy === "demo" ? "Loading…" : "Load demo data"}
          </Button>

          <Button
            variant="outline"
            onClick={() => inputRef.current?.click()}
            disabled={busy !== null}
          >
            <Upload className="size-4" aria-hidden />
            Choose a file
          </Button>
        </div>

        <p className="text-muted-foreground text-sm">
          No account, nothing stored publicly. Capped at{" "}
          {MAX_DEMO_ROWS.toLocaleString()} rows for this demo — a product
          decision, not a technical ceiling.
        </p>

        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void handleFile(file);
          }}
        />
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      )}
    </div>
  );
}
