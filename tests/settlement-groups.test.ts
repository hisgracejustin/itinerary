import test from "node:test";
import assert from "node:assert/strict";
import { allocateTransfer, allocateTransferByTrip, computeBalances, suggestTransfers } from "../src/lib/split.js";
import { settlementGroupInsertSchema } from "../src/lib/schemas";

// A multi-trip payment is recorded as one settlement per trip. These tests pin
// the property that matters: after recording the split, EVERY trip — viewed on
// its own — and the combined view are settled, and the parts add up to exactly
// what was paid.

const T1 = "00000000-0000-4000-8000-000000000001";
const T2 = "00000000-0000-4000-8000-000000000002";
const T3 = "00000000-0000-4000-8000-000000000003";

type Row = Record<string, unknown> & { trip_id: string };
type Data = {
  members: Row[];
  parties: Row[];
  bookings: Row[];
  expenses: Row[];
  settlements: Row[];
};

const member = (id: string, trip_id: string, party_id: string | null = null) => ({
  id,
  name: id.toUpperCase(),
  trip_id,
  party_id,
});

let seq = 0;
/** An expense `payer` paid in full, split evenly across `among`. */
const expense = (trip_id: string, payer: string, amount: number, among: string[], currency = "HKD") => ({
  id: `ex${++seq}`,
  trip_id,
  amount,
  currency,
  paid_by: payer,
  splits: among.map((user_id) => ({ user_id, weight: 1, extra_amount: 0, paid_amount: 0 })),
});

const onlyTrip = (data: Data, tripId: string): Data => ({
  members: data.members.filter((r) => r.trip_id === tripId),
  parties: data.parties.filter((r) => r.trip_id === tripId),
  bookings: data.bookings.filter((r) => r.trip_id === tripId),
  expenses: data.expenses.filter((r) => r.trip_id === tripId),
  settlements: data.settlements.filter((r) => r.trip_id === tripId),
});

/** Record allocated parts the way the server does: one settlement per part. */
const record = (data: Data, parts: Array<Record<string, unknown>>, currency: string): Data => ({
  ...data,
  settlements: [
    ...data.settlements,
    ...parts.map((p, i) => ({
      id: `st${++seq}-${i}`,
      trip_id: p.trip_id as string,
      from_user: p.from_user,
      to_user: p.to_user,
      amount: p.amount,
      currency,
      group_id: "group",
    })),
  ],
});

const pairs = (data: Data) =>
  computeBalances(data).pairTransfers.map((t) => ({
    from: t.fromUnit.key,
    to: t.toUnit.key,
    amount: Math.round(t.amount * 100) / 100,
    currency: t.currency,
  }));

const assertSettled = (data: Data, tripIds: string[]) => {
  for (const tripId of tripIds) {
    assert.deepEqual(pairs(onlyTrip(data, tripId)), [], `trip ${tripId} should be settled`);
  }
  assert.deepEqual(pairs(data), [], "combined view should be settled");
  for (const u of computeBalances(data).units) {
    for (const [cur, amt] of Object.entries(u.net as Record<string, number>)) {
      assert.ok(Math.abs(amt) < 0.005, `${u.key} still nets ${amt} ${cur}`);
    }
  }
};

const netOf = (parts: Array<{ amount: number; reverse: boolean }>) =>
  Math.round(parts.reduce((s, p) => s + (p.reverse ? -p.amount : p.amount), 0) * 100) / 100;

test("A owes B in two trips: the combined transfer splits by each trip's debt and settles both", () => {
  const data: Data = {
    members: [member("a", T1), member("b", T1), member("a", T2), member("b", T2)],
    parties: [],
    bookings: [],
    // A owes B 80 on trip 1, 40 on trip 2.
    expenses: [expense(T1, "b", 160, ["a", "b"]), expense(T2, "b", 80, ["a", "b"])],
    settlements: [],
  };
  // The combined Settle screen shows one transfer of 120.
  assert.deepEqual(pairs(data), [{ from: "a", to: "b", amount: 120, currency: "HKD" }]);

  const parts = allocateTransferByTrip({ ...data, fromKey: "a", toKey: "b", currency: "HKD", amount: 120 });
  assert.deepEqual(parts, [
    { trip_id: T1, from_user: "a", to_user: "b", amount: 80, reverse: false },
    { trip_id: T2, from_user: "a", to_user: "b", amount: 40, reverse: false },
  ]);
  assertSettled(record(data, parts!, "HKD"), [T1, T2]);
});

test("debts running both ways: the opposite trip is cleared with a reverse part and every trip ends at zero", () => {
  const data: Data = {
    members: [member("a", T1), member("b", T1), member("a", T2), member("b", T2)],
    parties: [],
    bookings: [],
    // A owes B 100 on trip 1; B owes A 30 on trip 2. Combined: A owes B 70.
    expenses: [expense(T1, "b", 200, ["a", "b"]), expense(T2, "a", 60, ["a", "b"])],
    settlements: [],
  };
  assert.deepEqual(pairs(data), [{ from: "a", to: "b", amount: 70, currency: "HKD" }]);

  const parts = allocateTransferByTrip({ ...data, fromKey: "a", toKey: "b", currency: "HKD", amount: 70 });
  assert.deepEqual(parts, [
    { trip_id: T1, from_user: "a", to_user: "b", amount: 100, reverse: false },
    { trip_id: T2, from_user: "b", to_user: "a", amount: 30, reverse: true },
  ]);
  assert.equal(netOf(parts!), 70);
  assertSettled(record(data, parts!, "HKD"), [T1, T2]);
});

test("a partial payment lands in proportion and leaves each trip's remainder in proportion", () => {
  const data: Data = {
    members: [member("a", T1), member("b", T1), member("a", T2), member("b", T2)],
    parties: [],
    bookings: [],
    expenses: [expense(T1, "b", 160, ["a", "b"]), expense(T2, "b", 80, ["a", "b"])],
    settlements: [],
  };
  const parts = allocateTransferByTrip({ ...data, fromKey: "a", toKey: "b", currency: "HKD", amount: 60 });
  assert.deepEqual(parts!.map((p) => [p.trip_id, p.amount]), [[T1, 40], [T2, 20]]);
  const after = record(data, parts!, "HKD");
  assert.deepEqual(pairs(onlyTrip(after, T1)), [{ from: "a", to: "b", amount: 40, currency: "HKD" }]);
  assert.deepEqual(pairs(onlyTrip(after, T2)), [{ from: "a", to: "b", amount: 20, currency: "HKD" }]);
  assert.deepEqual(pairs(after), [{ from: "a", to: "b", amount: 60, currency: "HKD" }]);
});

test("rounding: three equal debts split to the cent and add up exactly", () => {
  const trips = [T1, T2, T3];
  const data: Data = {
    members: trips.flatMap((t) => [member("a", t), member("b", t)]),
    parties: [],
    bookings: [],
    expenses: trips.map((t) => expense(t, "b", 20, ["a", "b"])), // 10 each
    settlements: [],
  };
  const parts = allocateTransferByTrip({ ...data, fromKey: "a", toKey: "b", currency: "HKD", amount: 10 });
  const amounts = parts!.map((p) => p.amount).sort();
  assert.deepEqual(amounts, [3.33, 3.33, 3.34]);
  assert.equal(netOf(parts!), 10);
});

test("zero-decimal currencies split in whole units", () => {
  const data: Data = {
    members: [T1, T2, T3].flatMap((t) => [member("a", t), member("b", t)]),
    parties: [],
    bookings: [],
    // A owes B ¥1000 on each trip.
    expenses: [T1, T2, T3].map((t) => expense(t, "b", 2000, ["a", "b"], "JPY")),
    settlements: [],
  };
  const parts = allocateTransferByTrip({ ...data, fromKey: "a", toKey: "b", currency: "JPY", amount: 1000 });
  for (const p of parts!) assert.ok(Number.isInteger(p.amount), `${p.amount} is not whole yen`);
  assert.equal(parts!.reduce((s, p) => s + p.amount, 0), 1000);

  const full = allocateTransferByTrip({ ...data, fromKey: "a", toKey: "b", currency: "JPY", amount: 3000 });
  assertSettled(record(data, full!, "JPY"), [T1, T2, T3]);
});

test("only the transfer's currency is split; the pair's debt in another currency is untouched", () => {
  const data: Data = {
    members: [member("a", T1), member("b", T1), member("a", T2), member("b", T2)],
    parties: [],
    bookings: [],
    expenses: [expense(T1, "b", 100, ["a", "b"]), expense(T2, "b", 100, ["a", "b"], "JPY")],
    settlements: [],
  };
  const parts = allocateTransferByTrip({ ...data, fromKey: "a", toKey: "b", currency: "HKD", amount: 50 });
  assert.deepEqual(parts, [{ trip_id: T1, from_user: "a", to_user: "b", amount: 50, reverse: false }]);
  assert.deepEqual(pairs(record(data, parts!, "HKD")), [{ from: "a", to: "b", amount: 50, currency: "JPY" }]);
});

test("a couple paying as one unit across trips is recorded with a member of each trip", () => {
  const data: Data = {
    members: [
      member("j", T1, "p1"), member("k", T1, "p1"), member("l", T1),
      member("j", T2, "p2"), member("k", T2, "p2"), member("l", T2),
    ],
    parties: [{ id: "p1", trip_id: T1, name: "J & K" }, { id: "p2", trip_id: T2, name: "J & K" }],
    bookings: [],
    // L paid; J+K (one unit) owe L a third of each.
    expenses: [expense(T1, "l", 300, ["j", "k", "l"]), expense(T2, "l", 150, ["j", "k", "l"])],
    settlements: [],
  };
  assert.deepEqual(pairs(data), [{ from: "j+k", to: "l", amount: 300, currency: "HKD" }]);
  const parts = allocateTransferByTrip({ ...data, fromKey: "j+k", toKey: "l", currency: "HKD", amount: 300 });
  assert.deepEqual(parts!.map((p) => [p.trip_id, p.from_user, p.to_user, p.amount]), [
    [T1, "j", "l", 200],
    [T2, "j", "l", 100],
  ]);
  assertSettled(record(data, parts!, "HKD"), [T1, T2]);
});

test("earlier payments are respected: only what's still owed per trip is split", () => {
  const data: Data = {
    members: [member("a", T1), member("b", T1), member("a", T2), member("b", T2)],
    parties: [],
    bookings: [],
    expenses: [expense(T1, "b", 160, ["a", "b"]), expense(T2, "b", 80, ["a", "b"])],
    // A already paid 50 on trip 1 (owes 30 there, 40 on trip 2).
    settlements: [{ id: "old", trip_id: T1, from_user: "a", to_user: "b", amount: 50, currency: "HKD" }],
  };
  const parts = allocateTransferByTrip({ ...data, fromKey: "a", toKey: "b", currency: "HKD", amount: 70 });
  assert.deepEqual(parts!.map((p) => [p.trip_id, p.amount]), [[T2, 40], [T1, 30]]);
  assertSettled(record(data, parts!, "HKD"), [T1, T2]);
});

test("a simplified transfer between people with no direct debt has no per-trip split", () => {
  const data: Data = {
    members: [member("a", T1), member("b", T1), member("b", T2), member("c", T2)],
    parties: [],
    bookings: [],
    // A owes B 50 on trip 1; B owes C 50 on trip 2. Simplified: A pays C.
    expenses: [expense(T1, "b", 100, ["a", "b"]), expense(T2, "c", 100, ["b", "c"])],
    settlements: [],
  };
  const simplified = suggestTransfers(computeBalances(data).units);
  assert.deepEqual(
    simplified.map((t) => [(t.fromUnit as { key: string }).key, (t.toUnit as { key: string }).key, t.amount]),
    [["a", "c", 50]],
  );
  assert.equal(allocateTransferByTrip({ ...data, fromKey: "a", toKey: "c", currency: "HKD", amount: 50 }), null);
  // Paying the wrong way round has no split either.
  assert.equal(allocateTransferByTrip({ ...data, fromKey: "b", toKey: "a", currency: "HKD", amount: 50 }), null);
});

test("bad input returns null rather than a bogus split", () => {
  const data: Data = {
    members: [member("a", T1), member("b", T1)],
    parties: [],
    bookings: [],
    expenses: [expense(T1, "b", 100, ["a", "b"])],
    settlements: [],
  };
  assert.equal(allocateTransferByTrip({ ...data, fromKey: "a", toKey: "b", currency: "HKD", amount: 0 }), null);
  assert.equal(allocateTransferByTrip({ ...data, fromKey: "a", toKey: "a", currency: "HKD", amount: 10 }), null);
});

test("group schema: needs two distinct trips and distinct part ids", () => {
  const part = (id: string, trip_id: string) => ({ id, trip_id, from_user: "a", to_user: "b", amount: 10 });
  const id1 = "10000000-0000-4000-8000-000000000001";
  const id2 = "10000000-0000-4000-8000-000000000002";
  const group_id = "20000000-0000-4000-8000-000000000001";
  const ok = { group_id, currency: "HKD", parts: [part(id1, T1), part(id2, T2)] };
  assert.equal(settlementGroupInsertSchema.safeParse(ok).success, true);
  assert.equal(settlementGroupInsertSchema.safeParse({ ...ok, parts: [part(id1, T1)] }).success, false);
  assert.equal(settlementGroupInsertSchema.safeParse({ ...ok, parts: [part(id1, T1), part(id2, T1)] }).success, false);
  assert.equal(settlementGroupInsertSchema.safeParse({ ...ok, parts: [part(id1, T1), part(id1, T2)] }).success, false);
  assert.equal(
    settlementGroupInsertSchema.safeParse({ ...ok, parts: [part(id1, T1), { ...part(id2, T2), to_user: "a" }] }).success,
    false,
  );
});

// Reported: a leftover CAD transfer settled fine with only Alaska selected, but
// with Alaska + Vancouver + North America selected Settle fell back to "pick a
// trip". The CAD debt lives on Alaska only, and with "simplify settlements" on
// the transfer is rerouted between people who don't owe each other directly.
const ALASKA = T1;
const VANCOUVER = T2;
const NORTH_AMERICA = T3;
const reported = (): Data => ({
  members: [ALASKA, VANCOUVER, NORTH_AMERICA].flatMap((t) => [member("a", t), member("b", t), member("c", t)]),
  parties: [],
  bookings: [],
  expenses: [
    // Alaska, CAD: A owes B 30; B owes C 30 → simplified, A pays C 30.
    expense(ALASKA, "b", 60, ["a", "b"], "CAD"),
    expense(ALASKA, "c", 60, ["b", "c"], "CAD"),
    // Other trips only in other currencies.
    expense(VANCOUVER, "a", 90, ["a", "b", "c"], "HKD"),
    expense(NORTH_AMERICA, "c", 90, ["a", "b", "c"], "USD"),
  ],
  settlements: [],
});

test("reported: a simplified CAD transfer settles on the one trip that holds the balances", () => {
  const data = reported();
  const cad = suggestTransfers(computeBalances(data).units).filter((t) => t.currency === "CAD");
  assert.deepEqual(cad.map((t) => [(t.fromUnit as { key: string }).key, (t.toUnit as { key: string }).key, t.amount]), [["a", "c", 30]]);

  // No direct debt between A and C, so the direct-debt split can't place it…
  assert.equal(allocateTransferByTrip({ ...data, fromKey: "a", toKey: "c", currency: "CAD", amount: 30 }), null);
  // …but by balances it belongs on Alaska, exactly as when Alaska alone is selected.
  const parts = allocateTransfer({ ...data, fromKey: "a", toKey: "c", currency: "CAD", amount: 30 });
  assert.deepEqual(parts, [{ trip_id: ALASKA, from_user: "a", to_user: "c", amount: 30, reverse: false }]);

  // Alaska's CAD balances are all square afterwards, and nothing else moved.
  const after = record(data, parts!, "CAD");
  for (const u of computeBalances(onlyTrip(after, ALASKA)).units) {
    assert.ok(Math.abs((u.net as Record<string, number>).CAD ?? 0) < 0.005, `${u.key} still nets CAD`);
  }
  assert.deepEqual(suggestTransfers(computeBalances(after).units).filter((t) => t.currency === "CAD"), []);
});

test("simplified transfer spread over two trips by balances, capped so nobody overshoots in a trip", () => {
  const data: Data = {
    members: [T1, T2].flatMap((t) => [member("a", t), member("b", t), member("c", t)]),
    parties: [],
    bookings: [],
    expenses: [
      // Trip 1: A owes B 20, B owes C 20. Trip 2: A owes B 10, B owes C 10.
      expense(T1, "b", 40, ["a", "b"]), expense(T1, "c", 40, ["b", "c"]),
      expense(T2, "b", 20, ["a", "b"]), expense(T2, "c", 20, ["b", "c"]),
    ],
    settlements: [],
  };
  const parts = allocateTransfer({ ...data, fromKey: "a", toKey: "c", currency: "HKD", amount: 30 });
  assert.deepEqual(parts!.map((p) => [p.trip_id, p.amount]), [[T1, 20], [T2, 10]]);
  const after = record(data, parts!, "HKD");
  for (const t of [T1, T2]) {
    for (const u of computeBalances(onlyTrip(after, t)).units) {
      assert.ok(Math.abs((u.net as Record<string, number>).HKD ?? 0) < 0.005, `${t}: ${u.key} still nets HKD`);
    }
  }
});

test("a simplified transfer that no set of trips can absorb still has no split", () => {
  const data: Data = {
    members: [member("a", T1), member("b", T1), member("b", T2), member("c", T2)],
    parties: [],
    bookings: [],
    // A owes B on trip 1 only; C is owed on trip 2 only — A and C never share a trip.
    expenses: [expense(T1, "b", 100, ["a", "b"]), expense(T2, "c", 100, ["b", "c"])],
    settlements: [],
  };
  assert.equal(allocateTransfer({ ...data, fromKey: "a", toKey: "c", currency: "HKD", amount: 50 }), null);
});

test("direct debts are split first, so opposite-direction trips are cleared exactly too", () => {
  const data: Data = {
    members: [member("a", T1), member("b", T1), member("a", T2), member("b", T2)],
    parties: [],
    bookings: [],
    expenses: [expense(T1, "b", 200, ["a", "b"]), expense(T2, "a", 60, ["a", "b"])],
    settlements: [],
  };
  const parts = allocateTransfer({ ...data, fromKey: "a", toKey: "b", currency: "HKD", amount: 70 });
  assert.deepEqual(parts!.map((p) => [p.trip_id, p.amount, p.reverse]), [[T1, 100, false], [T2, 30, true]]);
});
