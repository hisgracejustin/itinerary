import test from "node:test";
import assert from "node:assert/strict";

// getFxRatesOn reads stored rates and, when the day isn't there, asks
// Frankfurter once and keeps the answer. An in-memory database and a stubbed
// fetch stand in for Postgres and the network.
process.env.PGLITE_DIR = "memory://";
delete process.env.DATABASE_URL;

const calls: string[] = [];
let reply: (url: string) => Response | Promise<Response> = () => {
  throw new Error("offline");
};
globalThis.fetch = (async (input: string | URL) => {
  const url = String(input);
  calls.push(url);
  return reply(url);
}) as typeof fetch;
const frankfurter = (date: string, rates: Record<string, number>) =>
  // base=HKD: 1 HKD = X ccy, so invert ours.
  Response.json({ amount: 1, base: "HKD", date, rates: Object.fromEntries(Object.entries(rates).map(([c, r]) => [c, 1 / r])) });

const { db, dbReady, tables } = await import("../src/db");
const { getFxRatesOn, refreshFxRatesIfStale } = await import("../src/lib/fx");
await dbReady();

const DAY = 86_400_000;
const row = (rate_date: string, currency: string, rate_to_hkd: number, fetched_at = new Date(Date.now() - 2 * DAY)) => ({ rate_date, currency, rate_to_hkd, fetched_at });
await db.insert(tables.fxRates).values([
  row("2026-11-13", "CAD", 5.6), // Fri
  row("2026-11-13", "USD", 7.78),
  row("2026-11-16", "CAD", 5.62), // Mon
  row("2026-11-16", "USD", 7.78),
  row("2026-11-20", "CAD", 5.65), // Fri, the newest stored day
  row("2026-11-20", "USD", 7.79),
]);

test("a stored day is used as is, without asking Frankfurter", async () => {
  calls.length = 0;
  assert.deepEqual(await getFxRatesOn("2026-11-16"), { rateDate: "2026-11-16", rates: { CAD: 5.62, USD: 7.78 } });
  assert.equal(calls.length, 0);
});

test("a weekend reads Friday's rates", async () => {
  calls.length = 0;
  assert.equal((await getFxRatesOn("2026-11-15"))?.rateDate, "2026-11-13");
  assert.equal(calls.length, 0);
});

test("a missing weekday is fetched once, kept, then read back", async () => {
  calls.length = 0;
  reply = () => frankfurter("2026-11-18", { CAD: 5.63, USD: 7.785 });
  const first = await getFxRatesOn("2026-11-18");
  assert.equal(first?.rateDate, "2026-11-18");
  assert.ok(Math.abs(first!.rates.CAD - 5.63) < 1e-9);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/v1\/2026-11-18\?base=HKD&symbols=/);
  reply = () => {
    throw new Error("should not fetch again");
  };
  assert.equal((await getFxRatesOn("2026-11-18"))?.rateDate, "2026-11-18");
  assert.equal(calls.length, 1);
});

test("when Frankfurter fails, an earlier stored day that week stands in", async () => {
  reply = () => new Response("down", { status: 503 });
  assert.equal((await getFxRatesOn("2026-11-19"))?.rateDate, "2026-11-18");
});

test("nothing stored nearby and no answer → null, so the route uses the latest rates", async () => {
  reply = () => {
    throw new Error("offline");
  };
  assert.equal(await getFxRatesOn("2025-03-12"), null);
  assert.equal(await getFxRatesOn("not-a-date"), null);
});

test("a payload for another day, or off the USD peg, is not used or kept", async () => {
  reply = () => frankfurter("2026-11-27", { CAD: 5.6, USD: 7.8 }); // later than asked
  assert.equal(await getFxRatesOn("2025-06-11"), null);
  reply = () => frankfurter("2025-06-11", { CAD: 5.6, USD: 9.1 }); // off-peg
  assert.equal(await getFxRatesOn("2025-06-11"), null);
  const kept = await db.select().from(tables.fxRates);
  assert.ok(!kept.some((r) => r.rate_date.startsWith("2025-06")));
});

test("an old day lands in the table without delaying today's refresh", async () => {
  calls.length = 0;
  reply = () => frankfurter("2026-10-02", { CAD: 5.55, USD: 7.77 });
  assert.equal((await getFxRatesOn("2026-10-02"))?.rateDate, "2026-10-02");
  // The newest stored day was checked two days ago, so a refresh still runs.
  reply = () => frankfurter("2026-11-23", { CAD: 5.66, USD: 7.79 });
  await refreshFxRatesIfStale();
  assert.ok(calls.some((u) => u.includes("/v1/latest?")), calls.join(" "));
  const days = new Set((await db.select().from(tables.fxRates)).map((r) => r.rate_date));
  for (const d of ["2026-10-02", "2026-11-13", "2026-11-23"]) assert.ok(days.has(d), `${d} kept`);
});

test("a past day newer than anything stored is used but not kept", async () => {
  // Storing it would read as "today's rates were just checked".
  calls.length = 0;
  reply = () => frankfurter("2026-11-24", { CAD: 5.67, USD: 7.79 });
  assert.equal((await getFxRatesOn("2026-11-24"))?.rateDate, "2026-11-24");
  const days = new Set((await db.select().from(tables.fxRates)).map((r) => r.rate_date));
  assert.ok(!days.has("2026-11-24"));
});
