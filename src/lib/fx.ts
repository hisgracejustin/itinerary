// Live FX rates for the app's approximate ~HKD conversions. Server-only: this
// module touches the DB and the Frankfurter API, so it must never be imported
// into a client component.
//
// Semantics: our `rate_to_hkd` is "1 <currency> = Y HKD" (matching the static
// FX_RATES_TO_HKD table). Frankfurter's `base=HKD` payload gives the INVERSE
// ("1 HKD = X <currency>"), so we store Y = 1/X — see `deriveRates` below.
// Today's rates are refreshed lazily (after the response, via the layout's
// `after()`); a past day's rates are fetched once when something asks for them
// (getFxRatesOn). Both are sanity-checked before writing, and kept: rows are a
// few dozen a day, and the trip-summary PDF reads old days back. `toHKD`
// prefers these live rates and falls back to the static table.

import { and, desc, gte, lte, sql } from "drizzle-orm";
import { db, dbReady, tables } from "@/db";
import { CURRENCIES } from "@/lib/currencies";

const FRANKFURTER_API = "https://api.frankfurter.dev/v1";
const FETCH_TIMEOUT_MS = 15_000;
// A past day is fetched while someone waits for their PDF, so give up sooner.
const PAST_DAY_TIMEOUT_MS = 6_000;
const STALE_AFTER_MS = 24 * 60 * 60 * 1000; // refresh at most once per 24h
const MAX_JUMP_FRACTION = 0.2; // reject a rate that moved >20% from the last stored one
const PEG_LOW = 7.7; // USD→HKD peg band; outside it, write nothing
const PEG_HIGH = 7.9;
// The ECB publishes on working days only, so "the rates on a day" are the
// newest ones on or before it — at most a long holiday weekend earlier.
const LOOKBACK_DAYS = 6;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const daysBefore = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
/** The newest day the ECB can have published rates for by `day`: it, or the Friday before a weekend. */
const lastWorkingDay = (day: string) => {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return weekday === 0 ? daysBefore(day, 2) : weekday === 6 ? daysBefore(day, 1) : day;
};

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

/** Frankfurter's base=HKD rates ("1 HKD = X ccy") as ours: 1 ccy = 1/X HKD. */
function deriveRates(apiRates: Record<string, unknown>): { currency: string; rate: number }[] {
  const derived: { currency: string; rate: number }[] = [];
  for (const [ccy, x] of Object.entries(apiRates)) {
    if (typeof x !== "number" || !(x > 0)) continue;
    derived.push({ currency: ccy.toUpperCase(), rate: 1 / x });
  }
  return derived;
}

/** USD peg sanity check: an off-peg USD→HKD means a bad payload, so use none of it. */
function offPeg(derived: { currency: string; rate: number }[], rateDate: string): boolean {
  const usd = derived.find((d) => d.currency === "USD");
  if (usd && (usd.rate < PEG_LOW || usd.rate > PEG_HIGH)) {
    console.warn(
      `fx: derived USD→HKD ${usd.rate.toFixed(4)} for ${rateDate} outside [${PEG_LOW}, ${PEG_HIGH}] — nothing written`,
    );
    return true;
  }
  return false;
}

async function store(rateDate: string, rates: { currency: string; rate: number }[]) {
  await db
    .insert(tables.fxRates)
    .values(rates.map(({ currency, rate }) => ({ rate_date: rateDate, currency, rate_to_hkd: rate, fetched_at: new Date() })))
    .onConflictDoUpdate({
      target: [tables.fxRates.rate_date, tables.fxRates.currency],
      set: { rate_to_hkd: sql`excluded.rate_to_hkd`, fetched_at: new Date() },
    });
}

/** GET a Frankfurter rates payload, or null (logged) when it fails or looks wrong. */
async function fetchRates(url: string, timeoutMs: number): Promise<{ date: string; rates: Record<string, unknown> } | null> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    console.warn(`fx: fetch failed for ${url}:`, err);
    return null;
  }
  if (!res.ok) {
    console.warn(`fx: fetch failed for ${url}: HTTP ${res.status} ${res.statusText}`);
    return null;
  }
  const payload = (await res.json().catch(() => null)) as { date?: unknown; rates?: unknown } | null;
  const date = payload?.date;
  const rates = payload?.rates;
  if (typeof date !== "string" || !ISO_DAY.test(date) || !rates || typeof rates !== "object") {
    console.warn("fx: unexpected Frankfurter payload", payload);
    return null;
  }
  return { date, rates: rates as Record<string, unknown> };
}

// Module-level in-flight promise so overlapping requests share one fetch rather
// than each hitting Frankfurter.
let inFlight: Promise<void> | null = null;

/**
 * Refresh the FX cache if today's rates were last checked over 24h ago.
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

    // No-op when we last CHECKED within 24h. Deliberately keyed on fetched_at,
    // not rate_date: the ECB publishes on business days only, so over a weekend
    // the newest rate_date stays Friday's and a rate_date check would re-hit
    // Frankfurter on every single request until Monday's rate lands. Read off
    // the NEWEST day's rows (each check re-stamps them), so fetching an old
    // day for a PDF doesn't count as having checked today's.
    const [newest] = await db
      .select({ fetchedAt: tables.fxRates.fetched_at })
      .from(tables.fxRates)
      .orderBy(desc(tables.fxRates.rate_date), desc(tables.fxRates.fetched_at))
      .limit(1);
    if (newest && Date.now() - newest.fetchedAt.getTime() < STALE_AFTER_MS) return;

    // base=HKD → the payload gives 1 HKD = X ccy; deriveRates stores the inverse.
    const payload = await fetchRates(`${FRANKFURTER_API}/latest?base=HKD&symbols=${SYMBOLS.join(",")}`, FETCH_TIMEOUT_MS);
    if (!payload) return;
    const rateDate = payload.date;
    const derived = deriveRates(payload.rates);
    if (offPeg(derived, rateDate)) return;

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
    await store(rateDate, accepted);
  } catch (err) {
    console.warn("fx: refresh failed:", err);
  }
}

/** Stored rates on or shortly before `day`: per currency the newest such row. */
async function storedRatesOn(day: string): Promise<{ rates: Record<string, number>; rateDate: string } | null> {
  const rows = await db
    .select({ currency: tables.fxRates.currency, rate: tables.fxRates.rate_to_hkd, rateDate: tables.fxRates.rate_date })
    .from(tables.fxRates)
    .where(and(lte(tables.fxRates.rate_date, day), gte(tables.fxRates.rate_date, daysBefore(day, LOOKBACK_DAYS))))
    .orderBy(desc(tables.fxRates.rate_date));
  if (rows.length === 0) return null;
  const rates: Record<string, number> = {};
  for (const r of rows) if (!(r.currency in rates)) rates[r.currency] = r.rate;
  return { rates, rateDate: rows[0].rateDate };
}

/**
 * The daily rates as they stood on `day` ("YYYY-MM-DD"): the newest
 * publication on or before it. Stored rates answer when they include that
 * day's (or, for a weekend, Friday's); otherwise Frankfurter is asked for that
 * date once and the answer is kept. An older stored day from the same week
 * stands in if that fails; null when there is nothing either way, so the
 * caller can fall back to the latest rates. Never throws.
 */
export async function getFxRatesOn(day: string): Promise<{ rates: Record<string, number>; rateDate: string } | null> {
  if (!ISO_DAY.test(day)) return null;
  try {
    await dbReady();
    const stored = await storedRatesOn(day);
    if (stored && stored.rateDate >= lastWorkingDay(day)) return stored;

    const payload = await fetchRates(`${FRANKFURTER_API}/${day}?base=HKD&symbols=${SYMBOLS.join(",")}`, PAST_DAY_TIMEOUT_MS);
    // Frankfurter answers with the newest publication on or before the date
    // asked; anything else (a future date's "latest", a far older one) isn't
    // that day's rates.
    if (payload && payload.date <= day && payload.date >= daysBefore(day, LOOKBACK_DAYS)) {
      const derived = deriveRates(payload.rates);
      if (derived.length && !offPeg(derived, payload.date)) {
        // Kept for next time — unless it would become the newest day stored,
        // which doRefresh reads as "today's rates were just checked".
        const [newest] = await db
          .select({ rateDate: tables.fxRates.rate_date })
          .from(tables.fxRates)
          .orderBy(desc(tables.fxRates.rate_date))
          .limit(1);
        if (newest && payload.date < newest.rateDate) await store(payload.date, derived);
        if (!stored || payload.date >= stored.rateDate) {
          return { rates: Object.fromEntries(derived.map((d) => [d.currency, d.rate])), rateDate: payload.date };
        }
      }
    }
    return stored;
  } catch (err) {
    console.warn(`fx: rates for ${day} failed:`, err);
    return null;
  }
}
