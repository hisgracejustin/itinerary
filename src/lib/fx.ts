// Live FX rates for the app's approximate ~HKD conversions. Server-only: this
// module touches the DB and the Frankfurter API, so it must never be imported
// into a client component.
//
// Semantics: our `rate_to_hkd` is "1 <currency> = Y HKD" (matching the static
// FX_RATES_TO_HKD table). Frankfurter's `base=HKD` payload gives the INVERSE
// ("1 HKD = X <currency>"), so we store Y = 1/X — see the inversion in
// `doRefresh` below. Rates are refreshed lazily (after the response, via the
// layout's `after()`), sanity-checked before writing, and pruned to a rolling
// window. `toHKD` prefers these live rates and falls back to the static table.

import { desc, lt, sql } from "drizzle-orm";
import { db, dbReady, tables } from "@/db";
import { CURRENCIES } from "@/lib/currencies";

const FRANKFURTER_URL = "https://api.frankfurter.dev/v1/latest";
const FETCH_TIMEOUT_MS = 15_000;
const STALE_AFTER_MS = 24 * 60 * 60 * 1000; // refresh at most once per 24h
const MAX_JUMP_FRACTION = 0.2; // reject a rate that moved >20% from the last stored one
const PEG_LOW = 7.7; // USD→HKD peg band; outside it, write nothing
const PEG_HIGH = 7.9;
const WINDOW_DAYS = 30; // keep ~a month of rows, prune older

// Every supported currency except HKD (the base we quote against).
const SYMBOLS = CURRENCIES.map((c) => c.code).filter((c) => c !== "HKD");

/** Newest row per currency, as a Map(currency → rate_to_hkd). */
async function latestStoredRates(): Promise<Map<string, number>> {
  const rows = await db
    .selectDistinctOn([tables.fxRates.currency], {
      currency: tables.fxRates.currency,
      rate: tables.fxRates.rate_to_hkd,
    })
    .from(tables.fxRates)
    .orderBy(tables.fxRates.currency, desc(tables.fxRates.rate_date));
  return new Map(rows.map((r) => [r.currency, r.rate]));
}

/**
 * The latest live rates for display. Newest row per currency in one query.
 * `rateDate` is the newest date seen and `fetchedAt` that row's fetch time.
 * Returns empty/nulls when the cache has never been populated.
 */
export async function getLatestFxRates(): Promise<{
  rates: Record<string, number>;
  rateDate: string | null;
  fetchedAt: Date | null;
}> {
  await dbReady();
  const rows = await db
    .selectDistinctOn([tables.fxRates.currency], {
      currency: tables.fxRates.currency,
      rate: tables.fxRates.rate_to_hkd,
      rateDate: tables.fxRates.rate_date,
      fetchedAt: tables.fxRates.fetched_at,
    })
    .from(tables.fxRates)
    .orderBy(tables.fxRates.currency, desc(tables.fxRates.rate_date));
  if (rows.length === 0) return { rates: {}, rateDate: null, fetchedAt: null };
  const rates: Record<string, number> = {};
  let rateDate: string | null = null;
  let fetchedAt: Date | null = null;
  for (const r of rows) {
    rates[r.currency] = r.rate;
    if (!rateDate || r.rateDate > rateDate) {
      rateDate = r.rateDate;
      fetchedAt = r.fetchedAt;
    }
  }
  return { rates, rateDate, fetchedAt };
}

// Module-level in-flight promise so overlapping requests share one fetch rather
// than each hitting Frankfurter.
let inFlight: Promise<void> | null = null;

/**
 * Refresh the rolling FX cache if the newest stored rate is older than 24h.
 * NEVER throws to its caller — every error is caught and logged, so it is safe
 * to fire-and-forget from `after()`.
 */
export function refreshFxRatesIfStale(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = doRefresh().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doRefresh(): Promise<void> {
  try {
    await dbReady();

    // No-op when the newest stored rate_date is within 24h of now.
    const [newest] = await db
      .select({ rateDate: tables.fxRates.rate_date })
      .from(tables.fxRates)
      .orderBy(desc(tables.fxRates.rate_date))
      .limit(1);
    if (newest && Date.now() - Date.parse(newest.rateDate) < STALE_AFTER_MS) return;

    // base=HKD → the payload gives 1 HKD = X ccy; we store the inverse below.
    const url = `${FRANKFURTER_URL}?base=HKD&symbols=${SYMBOLS.join(",")}`;
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (err) {
      console.warn(`fx: fetch failed for ${url}:`, err);
      return;
    }
    if (!res.ok) {
      console.warn(`fx: fetch failed for ${url}: HTTP ${res.status} ${res.statusText}`);
      return;
    }
    const payload = (await res.json()) as { date?: string; rates?: Record<string, number> };
    const rateDate = payload?.date;
    const apiRates = payload?.rates;
    if (!rateDate || !apiRates || typeof apiRates !== "object") {
      console.warn("fx: unexpected Frankfurter payload", payload);
      return;
    }

    // INVERSION: our semantic is 1 ccy = Y HKD, so Y = 1 / (1 HKD = X ccy).
    const derived: { currency: string; rate: number }[] = [];
    for (const [ccy, x] of Object.entries(apiRates)) {
      if (typeof x !== "number" || !(x > 0)) continue;
      derived.push({ currency: ccy.toUpperCase(), rate: 1 / x });
    }

    // USD peg sanity check — if the derived USD→HKD is off-peg, write NOTHING.
    const usd = derived.find((d) => d.currency === "USD");
    if (usd && (usd.rate < PEG_LOW || usd.rate > PEG_HIGH)) {
      console.warn(
        `fx: derived USD→HKD ${usd.rate.toFixed(4)} outside [${PEG_LOW}, ${PEG_HIGH}] — nothing written`,
      );
      return;
    }

    // Reject any currency that moved >20% from its last stored rate.
    const previous = await latestStoredRates();
    const accepted = derived.filter(({ currency, rate }) => {
      const prev = previous.get(currency);
      if (prev && Math.abs(rate / prev - 1) > MAX_JUMP_FRACTION) {
        console.warn(
          `fx: rejected ${currency}=${rate} for ${rateDate} — deviates >20% from last stored ${prev}`,
        );
        return false;
      }
      return true;
    });
    if (accepted.length === 0) return;

    await db
      .insert(tables.fxRates)
      .values(
        accepted.map(({ currency, rate }) => ({
          rate_date: rateDate,
          currency,
          rate_to_hkd: rate,
          fetched_at: new Date(),
        })),
      )
      .onConflictDoUpdate({
        target: [tables.fxRates.rate_date, tables.fxRates.currency],
        set: { rate_to_hkd: sql`excluded.rate_to_hkd`, fetched_at: new Date() },
      });

    // Prune rows older than the rolling window.
    const cutoff = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    await db.delete(tables.fxRates).where(lt(tables.fxRates.rate_date, cutoff));
  } catch (err) {
    console.warn("fx: refresh failed:", err);
  }
}
