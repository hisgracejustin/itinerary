"use client";

import { useEffect } from "react";

/**
 * Keeps the offline day sheet fresh: whenever the app is opened online, it
 * fetches /sheet (and the attachments worth carrying) in the background so the
 * service worker re-caches them. Everything is fire-and-forget — the shell must
 * never wait on, or fail because of, this.
 */

// Once per page session; a client navigation shouldn't re-pull the sheet.
let syncedThisSession = false;
const REFRESH_MS = 60 * 60 * 1000;
const OWNER_KEY = "sheet-owner";
const SYNCED_AT_KEY = "sheet-synced-at";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — we just re-sync more often */
  }
}

async function sync() {
  const res = await fetch("/api/sheet-manifest", { cache: "no-store" });
  if (!res.ok) return;
  const manifest: { userId: string; attachments: string[] } = await res.json();

  // A different account on the same browser: the cached sheet is someone else's
  // itinerary, so drop it before caching this one.
  const previousOwner = read(OWNER_KEY);
  const switched = !!previousOwner && previousOwner !== manifest.userId;
  if (switched) navigator.serviceWorker?.controller?.postMessage({ type: "purge-sheet" });
  write(OWNER_KEY, manifest.userId);

  const lastSynced = Number(read(SYNCED_AT_KEY) ?? 0);
  if (!switched && Date.now() - lastSynced < REFRESH_MS) return;

  // Drain each body: the SW caches a clone, and abandoning our half of the tee
  // can cancel the download mid-flight.
  const res2 = await fetch("/sheet", { cache: "no-store" });
  if (!res2.ok || res2.redirected) return;
  await res2.blob();
  write(SYNCED_AT_KEY, String(Date.now()));

  // Sequential on purpose — attachments are up to 10MB each and this runs while
  // the user is actually using the app.
  for (const url of manifest.attachments) {
    try {
      const file = await fetch(url, { cache: "no-store" });
      await file.blob();
    } catch {
      /* one missing file doesn't stop the rest */
    }
  }
}

export function SheetSync() {
  useEffect(() => {
    if (syncedThisSession || !navigator.onLine) return;
    syncedThisSession = true;
    sync().catch(() => {});
  }, []);
  return null;
}
