import test from "node:test";
import assert from "node:assert/strict";
import { computeBalances } from "../src/lib/split.js";
import { buildTripSummary, plainText } from "../src/lib/trip-summary.js";

// The trip-summary PDF is built from computeBalances / suggestTransfers, so its
// numbers are the ones Settle up shows. These tests use the sample trip from the
// PDF mockup and pin the figures it showed.

const T = "11111111-1111-4111-8111-111111111111";
const member = (id: string, name: string, party_id: string | null = null) => ({ id, name, email: `${id}@test.dev`, trip_id: T, party_id });
const split = (ids: string[]) => ids.map((user_id) => ({ user_id, weight: 1, extra_amount: 0, paid_amount: 0 }));
const all = ["alice", "bob", "sophie"];
const booking = (id: string, type: string, title: string, start: string, amount: number, currency: string, paid_by: string, among = all, extra: Record<string, unknown> = {}) => ({
  id, trip_id: T, type, title, start_date: `${start}T10:00`, end_date: null, details: {}, provider: null,
  cost_amount: amount, cost_currency: currency, cost_share: 1, paid_by, splits: split(among),
  charged_currency: null, charged_rate: null, cancelled_at: null, retained_amount: 0, ...extra,
});
const expense = (id: string, title: string, category: string, date: string, amount: number, currency: string, paid_by: string, among = all, extra: Record<string, unknown> = {}) => ({
  id, trip_id: T, title, category, date, amount, currency, paid_by, splits: split(among),
  charged_currency: null, charged_rate: null, ...extra,
});

const sample = () => ({
  trip: { name: "Canada & Alaska", start_date: "2026-11-10", end_date: "2026-11-24" },
  members: [member("alice", "Alice Chan"), member("bob", "Bob Lee"), member("sophie", "Sophie Wong")],
  parties: [] as Array<Record<string, unknown>>,
  bookings: [
    booking("b1", "flight", "CX 888 Hong Kong → Vancouver", "2026-11-10", 15061, "HKD", "alice", all,
      { details: { flight_number: "CX888", departure_airport: "HKG", arrival_airport: "YVR" } }),
    booking("b2", "hotel", "Fairmont Pacific Rim", "2026-11-10", 2400, "CAD", "bob", all, { end_date: "2026-11-14T11:00", provider: "Fairmont" }),
    booking("b3", "activity", "Whale watching tour", "2026-11-12", 450, "CAD", "alice", all, { details: { location: "Victoria Inner Harbour" } }),
    booking("b4", "train", "Rocky Mountaineer to Banff", "2026-11-14", 3800, "CAD", "sophie"),
    booking("b5", "bus", "Banff Roam transit", "2026-11-16", 60, "CAD", "sophie"),
    booking("b6", "rental", "Hertz SUV", "2026-11-17", 620, "CAD", "bob"),
    booking("b7", "cruise", "Inside Passage cruise", "2026-11-20", 5200, "CAD", "alice"),
  ],
  expenses: [
    expense("e1", "Dinner at Miku", "food", "2026-11-11", 210.5, "CAD", "sophie"),
    expense("e2", "Groceries", "groceries", "2026-11-15", 86.2, "CAD", "bob"),
    expense("e3", "Sea to Sky Gondola", "activities", "2026-11-13", 390, "CAD", "alice"),
    expense("e4", "Airport taxi", "transport", "2026-11-10", 280, "HKD", "alice", ["alice", "bob"]),
    expense("e5", "Brunch at Hello Sunshine", "food", "2026-11-18", 96.4, "CAD", "bob"),
    expense("e6", "Park pass", "activities", "2026-11-15", 63, "CAD", "sophie"),
  ],
  settlements: [
    { id: "s1", trip_id: T, from_user: "bob", to_user: "alice", amount: 500, currency: "HKD", note: "Taxi and snacks", paid_currency: null, paid_amount: null, created_at: "2026-11-12T09:00:00Z" },
    { id: "s2", trip_id: T, from_user: "sophie", to_user: "alice", amount: 40, currency: "CAD", note: null, paid_currency: "HKD", paid_amount: 227.2, created_at: "2026-11-16T09:00:00Z" },
  ],
  rates: { CAD: 5.6789 },
  rateDate: "2026-11-20",
  preparedBy: "Alice Chan",
  generatedOn: "2026-11-21",
});

const near = (a: number, b: number, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

test("computeBalances' per-cost breakdown adds up to each unit's paid and owed", () => {
  const s = sample();
  const { units, costs } = computeBalances(s);
  assert.equal(costs.length, 13);
  const paid: Record<string, Record<string, number>> = {};
  const owed: Record<string, Record<string, number>> = {};
  for (const c of costs) {
    const shareSum = [...c.shares.values()].reduce((a, b) => a + b, 0);
    const paidSum = [...c.paid.values()].reduce((a, b) => a + b, 0);
    near(shareSum, c.amount, 1e-6);
    near(paidSum, c.amount, 1e-6);
    for (const [k, v] of c.shares) (owed[k] ??= {})[c.currency] = (owed[k][c.currency] ?? 0) + v;
    for (const [k, v] of c.paid) (paid[k] ??= {})[c.currency] = (paid[k][c.currency] ?? 0) + v;
  }
  for (const u of units) {
    for (const [cur, v] of Object.entries(u.owed as Record<string, number>)) near(owed[u.key][cur], v, 1e-6);
    for (const [cur, v] of Object.entries(u.paid as Record<string, number>)) near(paid[u.key][cur], v, 1e-6);
  }
});

test("the summary settles up exactly as Settle up does", () => {
  const sum = buildTripSummary(sample());
  assert.deepEqual(sum.settleUp.map((p) => [p.from, p.to, p.amounts]), [
    ["bob", "alice", [{ currency: "HKD", amount: 4660.33 }, { currency: "CAD", amount: 1256.1 }]],
    ["sophie", "alice", [{ currency: "HKD", amount: 5020.33 }, { currency: "CAD", amount: 285.2 }]],
  ]);
  near(sum.settleUp[0].approx, 11794);
  const bal = Object.fromEntries(sum.balances.map((b) => [b.key, b.net]));
  assert.deepEqual(bal, {
    alice: [{ currency: "HKD", amount: 9680.67 }, { currency: "CAD", amount: 1541.3 }],
    bob: [{ currency: "HKD", amount: -4660.33 }, { currency: "CAD", amount: -1256.1 }],
    sophie: [{ currency: "HKD", amount: -5020.33 }, { currency: "CAD", amount: -285.2 }],
  });
  assert.deepEqual(sum.people.map((p) => [p.key, p.name, p.members.map((m) => m.initials)]), [
    ["alice", "Alice Chan", ["AC"]], ["bob", "Bob Lee", ["BL"]], ["sophie", "Sophie Wong", ["SW"]],
  ]);
});

test("costs are grouped by category, biggest first, with each person's share", () => {
  const sum = buildTripSummary(sample());
  assert.deepEqual(sum.categories.map((c) => c.label), [
    "Cruises", "Trains", "Flights", "Accommodation", "Activities", "Rentals", "Food & drink", "Groceries", "Buses", "Transport",
  ]);
  const activities = sum.categories.find((c) => c.key === "activities")!;
  assert.deepEqual(activities.costs.map((r) => [r.title, r.icon]), [
    ["Whale watching tour", "activity"], ["Sea to Sky Gondola", "activities"], ["Park pass", "activities"],
  ]);
  assert.deepEqual(activities.totals, [{ currency: "CAD", amount: 903 }]);
  const taxi = sum.categories.find((c) => c.key === "expense:transport")!.costs[0];
  assert.deepEqual([taxi.amount, taxi.currency, taxi.paidBy?.name, taxi.shares], [280, "HKD", "Alice Chan", { alice: 140, bob: 140 }]);
  const flight = sum.categories.find((c) => c.key === "flight")!.costs[0];
  assert.equal(flight.sub, "CX888 · HKG → YVR");
  assert.equal(sum.categories.find((c) => c.key === "hotel")!.costs[0].sub, "4 nights · Fairmont");
  assert.equal(sum.totals.costCount, 13);
  assert.equal(sum.totals.paymentCount, 2);
  near(sum.totals.approx, 91303);
  near(sum.totals.perPerson, 91303 / 3);
  assert.deepEqual(sum.upfront.map((u) => [u.key, Math.round(u.share * 100)]), [["alice", 54], ["bob", 20], ["sophie", 26]]);
  assert.deepEqual(sum.payments.map((p) => [p.from.name, p.to.name, p.amount, p.currency, p.paid]), [
    ["Bob Lee", "Alice Chan", 500, "HKD", null],
    ["Sophie Wong", "Alice Chan", 40, "CAD", { currency: "HKD", amount: 227.2 }],
  ]);
  assert.deepEqual(sum.rates, { live: true, date: "2026-11-20", basis: "latest", missing: [], list: [{ currency: "CAD", rate: 5.6789 }] });
  assert.equal(sum.trip.nights, 14);
});

test("costs by currency: exact totals, the ≈ home value, share and the rate used", () => {
  const sum = buildTripSummary(sample());
  assert.deepEqual(sum.currencies.map((c) => [c.currency, c.rate]), [["CAD", 5.6789], ["HKD", null]]);
  const exact = (currency: string) =>
    sum.categories.flatMap((c) => c.costs).filter((r) => r.currency === currency).reduce((t, r) => t + r.amount, 0);
  for (const c of sum.currencies) near(c.amount, exact(c.currency), 0.001);
  near(sum.currencies[0].approx, sum.currencies[0].amount * 5.6789, 0.01);
  near(sum.currencies.reduce((t, c) => t + c.approx, 0), sum.totals.approx, 0.01);
  near(sum.currencies.reduce((t, c) => t + c.share, 0), 1, 1e-9);
});

test("rates: the basis passes through, and a currency with no daily rate is named", () => {
  const s = sample();
  s.expenses.push(expense("e9", "Bubble tea", "food", "2026-11-19", 120, "TWD", "alice"));
  const sum = buildTripSummary({ ...s, rateBasis: "trip-end" });
  assert.equal(sum.rates.basis, "trip-end");
  assert.deepEqual([sum.rates.live, sum.rates.date, sum.rates.missing], [false, "2026-11-20", ["TWD"]]);
  assert.equal(sum.currencies.find((c) => c.currency === "TWD")!.rate, 0.24); // the built-in table
  const none = buildTripSummary({ ...sample(), rates: {}, rateBasis: "bogus" as never });
  assert.deepEqual([none.rates.basis, none.rates.date, none.rates.missing], ["latest", null, ["CAD"]]);
});

test("a couple who share costs is one person in the summary", () => {
  const s = sample();
  s.members = [member("alice", "Alice Chan"), member("bob", "Bob Lee", "p1"), member("sophie", "Sophie Wong", "p1")];
  s.parties = [{ id: "p1", trip_id: T, name: "Bob & Sophie" }];
  const sum = buildTripSummary(s);
  assert.deepEqual(sum.people.map((p) => [p.key, p.name, p.members.length]), [["alice", "Alice Chan", 1], ["bob+sophie", "Bob & Sophie", 2]]);
  assert.deepEqual(sum.settleUp.map((p) => [p.from, p.to]), [["bob+sophie", "alice"]]);
  const cruise = sum.categories.find((c) => c.key === "cruise")!.costs[0];
  assert.deepEqual(cruise.shares, { alice: 1733.33, "bob+sophie": 3466.67 });
  // Shares are by couple, but "paid by" is still the person who paid.
  const train = sum.categories.find((c) => c.key === "train")!.costs[0];
  assert.deepEqual([train.paidBy?.name, train.otherPayers], ["Sophie Wong", 0]);
});

test("payment dates: database timestamps, in the exporter's time zone, oldest first", () => {
  const s = sample();
  // As the database returns them: Date objects, newest first. 23:30 UTC on the
  // 12th is already the 13th in Hong Kong.
  s.settlements = [
    { ...s.settlements[1], created_at: new Date("2026-11-16T09:00:00Z") as unknown as string },
    { ...s.settlements[0], created_at: new Date("2026-11-12T23:30:00Z") as unknown as string },
  ];
  const utc = buildTripSummary(s);
  assert.deepEqual(utc.payments.map((p) => [p.from.name, p.date]), [["Bob Lee", "2026-11-12"], ["Sophie Wong", "2026-11-16"]]);
  const hk = buildTripSummary({ ...s, timeZone: "Asia/Hong_Kong" });
  assert.deepEqual(hk.payments.map((p) => [p.from.name, p.date]), [["Bob Lee", "2026-11-13"], ["Sophie Wong", "2026-11-16"]]);
});

test("cancelled, charged-in-another-currency and unsplit costs", () => {
  const s = sample();
  s.bookings.push(booking("b8", "activity", "Glacier flight", "2026-11-21", 900, "CAD", "alice", all,
    { cancelled_at: "2026-11-19T00:00:00Z", retained_amount: 150 }));
  s.expenses.push(expense("e7", "Duty free", "shopping", "2026-11-24", 100, "USD", "bob", all, { charged_currency: "HKD", charged_rate: 7.8 }));
  s.expenses.push(expense("e8", "Souvenirs", "shopping", "2026-11-23", 40, "CAD", "bob", []));
  const sum = buildTripSummary(s);
  const glacier = sum.categories.find((c) => c.key === "activities")!.costs.find((r) => r.title === "Glacier flight")!;
  assert.deepEqual([glacier.amount, glacier.notes], [150, ["Cancelled · C$150.00 kept of C$900.00"]]);
  const duty = sum.categories.find((c) => c.key === "expense:shopping")!.costs[0];
  assert.deepEqual([duty.amount, duty.currency, duty.notes], [780, "HKD", ["$100.00 charged in HKD at 7.8"]]);
  assert.equal(sum.notSplit, 1);
  assert.equal(sum.totals.costCount, 15);
});

test("free text loses emoji (the PDF fonts can't draw them) but keeps every language", () => {
  assert.equal(plainText("🍣 Sushi night 🇯🇵"), "Sushi night");
  assert.equal(plainText("Café ☕️ Zoë"), "Café Zoë");
  assert.equal(plainText("陳大文 · 大館 · ホテル"), "陳大文 · 大館 · ホテル");
  assert.equal(plainText("👨‍👩‍👧 Family"), "Family");
  const s = sample();
  s.trip.name = "🏔️ Canada & Alaska";
  assert.equal(buildTripSummary(s).trip.name, "Canada & Alaska");
});
