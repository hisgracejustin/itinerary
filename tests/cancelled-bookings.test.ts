import test from "node:test";
import assert from "node:assert/strict";
import { computeBalances } from "../src/lib/split.js";
import {
  bookingEffective,
  bookingOriginal,
  isCancelled,
  retentionFactor,
  scaledSplits,
} from "../src/lib/booking-cost.js";
import { bookingCostItem, itemContribution, scopeUserIds } from "../src/lib/cost-items.js";
import { hasOvernightCoverage } from "../src/lib/calendar.js";

// computeBalances is JSDoc-typed, where the per-currency maps are a bare
// `object`. This names what they actually are so the assertions can index them.
const hkd = (m: object) => (m as Record<string, number>).HKD ?? 0;

const trip_id = "00000000-0000-4000-8000-000000000001";
const members = [
  { id: "a", name: "Ann", trip_id, party_id: null },
  { id: "b", name: "Ben", trip_id, party_id: null },
  { id: "c", name: "Cal", trip_id, party_id: null },
  { id: "d", name: "Dee", trip_id, party_id: null },
];

/** The plan's worked example: a 4-way flight where one traveller has baggage. */
const flightSplits = [
  { user_id: "a", weight: 1, extra_amount: 447, paid_amount: 0 },
  { user_id: "b", weight: 1, extra_amount: 0, paid_amount: 0 },
  { user_id: "c", weight: 1, extra_amount: 0, paid_amount: 0 },
  { user_id: "d", weight: 1, extra_amount: 0, paid_amount: 0 },
];

const flight = (over: Record<string, unknown> = {}) => ({
  id: "bk1",
  trip_id,
  type: "flight",
  title: "HKG -> YVR",
  cost_amount: 15061,
  cost_currency: "HKD",
  cost_share: 1,
  paid_by: "a",
  cancelled_at: null,
  retained_amount: 0,
  splits: flightSplits,
  ...over,
});

/* ------------------------------ the base rule ------------------------------ */

test("a live booking is unaffected - effective cost is amount x share, factor 1", () => {
  const b = flight({ cost_share: 0.5 });
  assert.equal(isCancelled(b), false);
  assert.equal(bookingOriginal(b), 7530.5);
  assert.equal(bookingEffective(b), 7530.5);
  assert.equal(retentionFactor(b), 1);
  // Identity, not a copy: a live booking must not pay for the rescale.
  assert.equal(scaledSplits(b, flightSplits), flightSplits);
});

test("a cancelled booking's effective cost is the retained amount, not a subtraction", () => {
  const b = flight({ cancelled_at: new Date(), retained_amount: 500 });
  assert.equal(isCancelled(b), true);
  // The original survives for reporting...
  assert.equal(bookingOriginal(b), 15061);
  // ...but the effective cost is the fee outright. A stale cost_amount can
  // therefore never leak into a total.
  assert.equal(bookingEffective(b), 500);
});

test("cancelled with nothing retained contributes zero", () => {
  const b = flight({ cancelled_at: new Date(), retained_amount: 0 });
  assert.equal(bookingEffective(b), 0);
  assert.equal(retentionFactor(b), 0);
});

test("an unpriced booking cancelled with a fee stands on its own", () => {
  // No original to take a fraction of - the factor must not be NaN/Infinity.
  const b = flight({ cost_amount: null, cancelled_at: new Date(), retained_amount: 120 });
  assert.equal(retentionFactor(b), 0);
  assert.equal(bookingEffective(b), 120);
});

/* --------------------------- proportional rescale --------------------------- */

test("extras scale with the retention, so baggage can't eat the whole fee", () => {
  const b = flight({ cancelled_at: new Date(), retained_amount: 500 });
  const rows = scaledSplits(b, flightSplits);
  const factor = 500 / 15061;
  // Ann's 447 baggage extra is refunded along with the fare; what survives is
  // its share of the fee. Without this she'd owe 447 of the 500 and the other
  // three would split 53.
  assert.ok(Math.abs(rows[0].extra_amount - 447 * factor) < 1e-9);
  assert.ok(rows[0].extra_amount < 15, "the extra must shrink with the fare");
  assert.equal(rows[1].extra_amount, 0);
  // Weights are ratios and are left alone.
  assert.deepEqual(rows.map((r) => r.weight), [1, 1, 1, 1]);
});

test("paid_amount scales too - separate contributions were refunded as well", () => {
  const withContribution = [
    { user_id: "a", weight: 1, extra_amount: 0, paid_amount: 0 },
    { user_id: "b", weight: 1, extra_amount: 0, paid_amount: 1000 },
  ];
  const b = flight({
    cost_amount: 2000,
    splits: withContribution,
    cancelled_at: new Date(),
    retained_amount: 200,
  });
  const rows = scaledSplits(b, withContribution);
  assert.equal(rows[1].paid_amount, 100); // 1000 x (200/2000)
});

/* ------------------------------- settlement ------------------------------- */

test("a cancelled booking settles at the fee, zero-sum intact", () => {
  const b = flight({ cancelled_at: new Date(), retained_amount: 500 });
  const { units, unallocated, missingPayer } = computeBalances({
    members,
    parties: [],
    bookings: [b],
    expenses: [],
    settlements: [],
  });
  assert.equal(unallocated.length, 0);
  assert.equal(missingPayer.length, 0);

  // Ann fronted the fare and got the refund back on her own card, so what is
  // outstanding between the four of them is the 500 the airline kept.
  const paid = units.reduce((s, u) => s + hkd(u.paid), 0);
  const owed = units.reduce((s, u) => s + hkd(u.owed), 0);
  assert.ok(Math.abs(paid - 500) < 1e-9, `payer credited ${paid}, expected 500`);
  assert.ok(Math.abs(owed - 500) < 1e-9, `shares total ${owed}, expected 500`);
  // ...and the nets cancel out exactly.
  assert.ok(Math.abs(units.reduce((s, u) => s + hkd(u.net), 0)) < 1e-9);
});

test("cancelled with nothing retained leaves settlement entirely", () => {
  const b = flight({ cancelled_at: new Date(), retained_amount: 0 });
  const { units, unallocated, missingPayer } = computeBalances({
    members,
    parties: [],
    bookings: [b],
    expenses: [],
    settlements: [],
  });
  // The point of the null return in bookingItem: it must not resurface as a
  // permanent "needs attention" row about money that no longer exists.
  assert.equal(unallocated.length, 0);
  assert.equal(missingPayer.length, 0);
  assert.equal(units.reduce((s, u) => s + hkd(u.owed), 0), 0);
});

test("cancel then reinstate restores the balances to the cent", () => {
  const args = (b: unknown) => ({
    members,
    parties: [],
    bookings: [b],
    expenses: [],
    settlements: [],
  });
  const before = computeBalances(args(flight()));
  // Cancelling never rewrites the stored rows, so reinstating is a pure undo.
  computeBalances(args(flight({ cancelled_at: new Date(), retained_amount: 500 })));
  const after = computeBalances(args(flight({ cancelled_at: null, retained_amount: 0 })));
  assert.deepEqual(
    after.units.map((u) => [u.key, u.owed, u.paid, u.net]),
    before.units.map((u) => [u.key, u.owed, u.paid, u.net]),
  );
});

test("a cancelled booking that retained a fee but has no payer still needs attention", () => {
  const b = flight({ cancelled_at: new Date(), retained_amount: 500, paid_by: null });
  const { missingPayer } = computeBalances({
    members,
    parties: [],
    bookings: [b],
    expenses: [],
    settlements: [],
  });
  // Real money, unassigned - this one must NOT be filtered away.
  assert.equal(missingPayer.length, 1);
});

/* --------------------------------- /costs --------------------------------- */

test("the cost item keeps the original for reporting and the fee for spending", () => {
  const item = bookingCostItem(flight({ cancelled_at: new Date(), retained_amount: 500 }));
  assert.equal(item.cancelled, true);
  assert.equal(item.original, 15061);
  assert.equal(item.effective, 500);
});

test("a live cost item reports the same figure both ways", () => {
  const item = bookingCostItem(flight());
  assert.equal(item.cancelled, false);
  assert.equal(item.original, item.effective);
});

test("a viewer's share of a cancelled booking follows the scope chips", () => {
  const b = flight({ cancelled_at: new Date(), retained_amount: 500 });
  const item = bookingCostItem(b);
  const users = scopeUserIds({ scope: "me", trip: { members }, currentUserId: "b" });
  // Ben has no extras, so he owes a plain quarter of what's left after Ann's
  // scaled baggage - his share of the fee, not of the fare.
  const share = itemContribution(item, users)!;
  assert.ok(share > 0 && share < 500);
  const all = ["a", "b", "c", "d"].map(
    (id) => itemContribution(item, scopeUserIds({ scope: "me", trip: { members }, currentUserId: id }))!,
  );
  assert.ok(Math.abs(all.reduce((s, v) => s + v, 0) - 500) < 1e-9, "shares must total the fee");
});

/* -------------------------------- calendar -------------------------------- */

test("a cancelled stay is not a bed for the night", () => {
  const stay = {
    type: "hotel",
    start_date: "2026-09-05T15:00",
    end_date: "2026-09-07T11:00",
    cancelled_at: null,
  };
  const night = new Date(2026, 8, 5);
  assert.equal(hasOvernightCoverage([stay], night), true);
  // The worst failure this feature could introduce is telling someone they have
  // a bed on a night they have nowhere to sleep.
  assert.equal(hasOvernightCoverage([{ ...stay, cancelled_at: new Date() }], night), false);
});

test("an unpriced cancelled booking is worth nothing to any money surface", () => {
  // The reason the UI refuses a fee here and the action rejects one: a retained
  // amount is spent through the booking's own cost + currency, so with neither
  // there is nothing for /costs or settlement to count it as.
  const b = flight({ cost_amount: null, cancelled_at: new Date(), retained_amount: 120 });
  const { units, unallocated, missingPayer } = computeBalances({
    members,
    parties: [],
    bookings: [b],
    expenses: [],
    settlements: [],
  });
  assert.equal(unallocated.length, 0);
  assert.equal(missingPayer.length, 0);
  assert.equal(units.reduce((s, u) => s + hkd(u.owed), 0), 0);
});
