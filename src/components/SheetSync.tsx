"use client";

import { useEffect } from "react";
import { SHEET_CACHE, purgeSheetCache } from "@/lib/offline-sheet";

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

// On the worker's very first session (fresh install — every iOS home-screen add
// is one) our fetches race clients.claim(): issued before control, they bypass
// the worker and nothing gets cached. Wait for control, bounded so a browser
// with no SW support (or private mode) can't hang the sync forever.
async function whenControlled(timeoutMs = 10_000) {
  const sw = navigator.serviceWorker;
  if (!sw || sw.controller) return;
  await Promise.race([
    new Promise<void>((resolve) => {
      sw.addEventListener("controllerchange", () => resolve(), { once: true });
    }),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

async function sync() {
  await whenControlled();
  const res = await fetch("/api/sheet-manifest", { cache: "no-store" });
  if (!res.ok) return;
  const manifest: { userId: string; attachments: string[] } = await res.json();

  // A different account on the same browser: the cached sheet is someone else's
  // itinerary, so drop it before caching this one.
  const previousOwner = read(OWNER_KEY);
  const switched = !!previousOwner && previousOwner !== manifest.userId;
  // Await the purge before anything below it. Writing OWNER_KEY first would
  // record a purge that may never have happened (`switched` is then false
  // forever, so it's never retried); and the gap-fill loop reads this same
  // cache, so a delete still in flight makes it treat the previous user's
  // entries as hits, skip them, and then lose them to the delete.
  if (switched) await purgeSheetCache();
  write(OWNER_KEY, manifest.userId);

  // Attachments gap-fill on EVERY online open, outside the debounce: a file
  // uploaded five minutes after a sync must not wait out the refresh window to
  // become viewable offline (it did — "This file isn't saved on this device"
  // right after adding it). Already-cached files are skipped, so steady state
  // is one manifest read + N cache lookups. Sequential on purpose —
  // attachments are up to 10MB each and this runs while the user is actually
  // using the app.
  for (const url of manifest.attachments) {
    try {
      const hit = await window.caches?.match(url, { ignoreVary: true });
      if (hit) continue;
      // Drain the body: the SW caches a clone, and abandoning our half of the
      // tee can cancel the download mid-flight.
      const file = await fetch(url, { cache: "no-store" });
      await file.blob();
    } catch {
      /* one missing file doesn't stop the rest */
    }
  }

  const lastSynced = Number(read(SYNCED_AT_KEY) ?? 0);
  if (!switched && Date.now() - lastSynced < REFRESH_MS) return;

  const res2 = await fetch("/sheet", { cache: "no-store" });
  if (!res2.ok || res2.redirected) return;
  await res2.blob();

  // Trust the cache, not the fetch: if the request bypassed the worker (iOS
  // routes nothing through a first-session worker) this fetch "succeeds"
  // without caching anything — recording a sync then would debounce every
  // later session into skipping the retry, leaving offline empty for good.
  const cached = await window.caches
    ?.open(SHEET_CACHE)
    .then((c) => c.match("/sheet", { ignoreVary: true }))
    .catch(() => undefined);
  if (!cached) return;
  write(SYNCED_AT_KEY, String(Date.now()));
}

export function SheetSync() {
  useEffect(() => {
    if (syncedThisSession || !navigator.onLine) return;
    syncedThisSession = true;
    sync().catch(() => {});
  }, []);
  return null;
}
