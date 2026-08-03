"use client";

import Link from "next/link";

// Catches render/fetch failures anywhere under (app) — most often the database
// being unreachable, which is why the offline sheet is offered alongside retry:
// it's the one view that still works without a round trip.
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="mat-surface p-8 max-w-sm w-full text-center">
        <div className="w-16 h-16 rounded-full bg-surface-container flex items-center justify-center mb-4 mx-auto">
          <span className="text-2xl">⚠️</span>
        </div>
        <p className="text-sm font-medium text-on-surface">Something went wrong</p>
        <p className="text-xs mt-1 text-on-surface-variant/70">
          This page couldn&apos;t load. Try again — your trips are safe.
        </p>
        {error.digest && (
          <p className="text-[10px] mt-2 text-on-surface-variant/50">ref {error.digest}</p>
        )}
        <button type="button" onClick={reset} className="mat-btn-filled mt-5">
          Try again
        </button>
        <div className="mt-4 flex items-center justify-center gap-4">
          <Link href="/" className="text-xs text-primary font-medium hover:underline">
            Go home
          </Link>
          <Link href="/sheet" className="text-xs text-primary font-medium hover:underline">
            Open offline sheet
          </Link>
        </div>
      </div>
    </div>
  );
}
