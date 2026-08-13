"use client";

import { FileQuestion, RotateCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function WorkspaceSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading">
      <div className="bg-card rounded-lg border p-4">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="mt-2 h-4 w-72" />
        <Skeleton className="mt-4 h-2 w-full" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(280px,340px)_1fr]">
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function WorkspaceEmpty({
  title = "Nothing to review",
  description = "This dataset came back clean — no issues were detected.",
  action,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-12 text-center">
      <FileQuestion className="text-muted-foreground size-8" aria-hidden />
      <h2 className="font-semibold">{title}</h2>
      <p className="text-muted-foreground max-w-sm text-sm">{description}</p>
      {action}
    </div>
  );
}

export function WorkspaceError({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-lg border border-red-300 bg-red-50 p-12 text-center dark:border-red-900 dark:bg-red-950/30"
    >
      <TriangleAlert className="size-8 text-red-600 dark:text-red-400" aria-hidden />
      <h2 className="font-semibold text-red-900 dark:text-red-200">
        Something went wrong
      </h2>
      <p className="max-w-md text-sm text-red-800 dark:text-red-300">{message}</p>
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          <RotateCw className="size-4" aria-hidden />
          Try again
        </Button>
      )}
    </div>
  );
}
