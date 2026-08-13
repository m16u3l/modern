"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import { Sparkles, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MAX_DEMO_ROWS } from "@/lib/contracts";

export function UploadPanel() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | "demo" | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      <div className="flex flex-wrap gap-3">
        <Button onClick={startDemo} disabled={busy !== null}>
          <Sparkles className="size-4" aria-hidden />
          {busy === "demo" ? "Loading…" : "Load demo data"}
        </Button>

        <Button
          variant="outline"
          onClick={() => inputRef.current?.click()}
          disabled={busy !== null}
        >
          <Upload className="size-4" aria-hidden />
          {busy === "upload" ? "Uploading…" : "Upload a CSV"}
        </Button>

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
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <p className="text-muted-foreground text-xs">
        Capped at {MAX_DEMO_ROWS.toLocaleString()} rows for this demo — a product
        decision, not a technical ceiling.
      </p>
    </div>
  );
}
