import test from "node:test";
import assert from "node:assert/strict";
import {
  dailyRate,
  priceLegs,
  rateInput,
  resolvePaid,
  shownRate,
  startPaid,
  summarizePayment,
} from "../src/lib/settle-fx.js";
import { allocateTransfer, computeBalances, suggestTransfers } from "../src/lib/split.js";
import { settlementGroupInsertSchema, settlementInsertSchema } from "../src/lib/schemas";

// Paying a debt in another currency: the payment settles in the debt's own
// currency (amount + currency) and records what was sent (paid_currency +
// paid_amount). These tests pin the money math and, above all, that balances
// come out exactly settled with HKD balances untouched.

const T1 = "00000000-0000-4000-8000-000000000001";
const T2 = "00000000-0000-4000-8000-000000000002";
const fx = { rates: { CAD: 5.6789, USD: 7.7712, JPY: 0.0512 }, rateDate: "2026-10-26" };

type Ok = { paidCurrency: string; rate: number | null; total: number; legs: Array<{ paid_amount: number }> };
const ok = (r: unknown) => {
  assert.ok(r && typeof r === "object" && !("error" in r), `expected a price, got ${JSON.stringify(r)}`);
  return r as Ok;
};
const errorOf = (r: unknown) => (r as { error?: string } | null)?.error;

/* ------------------------------- daily rate ------------------------------- */

test("dailyRate: live rates, the inverse, a cross rate through HKD, and the built-in fallback", () => {
  assert.deepEqual(dailyRate("CAD", "HKD", fx), { rate: 5.6789, live: true, rateDate: "2026-10-26" });
  assert.equal(dailyRate("HKD", "CAD", fx)!.rate, 1 / 5.6789);
  assert.equal(dailyRate("CAD", "USD", fx)!.rate, 5.6789 / 7.7712);
  // No live EUR: the built-in table, flagged as not live and undated.
  assert.deepEqual(dailyRate("EUR", "HKD", fx), { rate: 8.5, live: false, rateDate: null });
  assert.deepEqual(dailyRate("CAD", "HKD", null), { rate: 5.7, live: false, rateDate: null });
  assert.equal(dailyRate("CAD", "CAD", fx), null);
  assert.equal(dailyRate("CAD", "XXX", fx), null);
});

test("rateInput keeps six significant figures", () => {
  assert.equal(rateInput(5.678912345), "5.67891");
  assert.equal(rateInput(1 / 5.6789), "0.17609");
  assert.equal(rateInput(0.00568412345), "0.00568412");
  assert.equal(rateInput(5.68), "5.68");
});

/* --------------------------------- pricing -------------------------------- */

test("one leg: CA$17.68 at 5.68 is HK$100.42", () => {
  const priced = priceLegs({ legs: [{ amount: 17.68, currency: "CAD" }], paidCurrency: "HKD", rates: { CAD: 5.68 } });
  assert.deepEqual(priced, { total: 100.42, legs: [{ amount: 17.68, currency: "CAD", paid_amount: 100.42 }] });
});

test("zero-decimal currencies round to whole units on either side", () => {
  const toYen = priceLegs({ legs: [{ amount: 100, currency: "HKD" }], paidCurrency: "JPY", rates: { HKD: 19.53 } });
  assert.equal(toYen!.total, 1953);
  const fromYen = priceLegs({ legs: [{ amount: 1953, currency: "JPY" }], paidCurrency: "HKD", rates: { JPY: 0.0512 } });
  assert.equal(fromYen!.total, 99.99);
  const yenToWon = priceLegs({ legs: [{ amount: 1000, currency: "JPY" }], paidCurrency: "KRW", rates: { JPY: 9.137 } });
  assert.equal(yenToWon!.total, 9137);
});

test("trip parts that run both ways: reverse parts count against the total, which is exact", () => {
  const legs = [
    { amount: 80, currency: "HKD", trip_id: "japan" },
    { amount: 40, currency: "HKD", trip_id: "korea" },
    { amount: 30, currency: "HKD", trip_id: "taiwan", reverse: true },
  ];
  const priced = priceLegs({ legs, paidCurrency: "CAD", rates: { HKD: 0.176 } })!;
  assert.deepEqual(priced.legs.map((l) => [l.trip_id, l.paid_amount]), [["japan", 14.08], ["korea", 7.04], ["taiwan", 5.28]]);
  assert.equal(priced.total, 15.84); // (80 + 40 − 30) × 0.176
});

test("the rounding remainder lands on the largest part, so the parts add up to the cent", () => {
  const legs = [10, 10, 10].map((amount) => ({ amount, currency: "HKD" }));
  const priced = priceLegs({ legs, paidCurrency: "CAD", rates: { HKD: 0.33333 } })!;
  assert.equal(priced.total, 10); // round(29.9999)
  const cents = priced.legs.map((l) => Math.round(l.paid_amount * 100));
  assert.equal(cents.reduce((s, c) => s + c, 0), 1000);
  assert.deepEqual(cents.sort(), [333, 333, 334]);
});

test("a typed total scales every part by the same factor", () => {
  const legs = [{ amount: 17.68, currency: "CAD" }, { amount: 10, currency: "CAD" }];
  const priced = priceLegs({ legs, paidCurrency: "HKD", rates: { CAD: 1 }, total: 157 })!;
  assert.equal(priced.total, 157);
  assert.deepEqual(priced.legs.map((l) => l.paid_amount), [100.28, 56.72]);
});

test("legs in several currencies price at their own rates (settling everything in one currency)", () => {
  // You owe Bob CA$17.68; Bob owes you US$10. Paid in HKD: you send the difference.
  const priced = priceLegs({
    legs: [
      { amount: 17.68, currency: "CAD" },
      { amount: 10, currency: "USD", reverse: true },
    ],
    paidCurrency: "HKD",
    rates: { CAD: 5.68, USD: 7.8 },
  })!;
  assert.deepEqual(priced.legs.map((l) => l.paid_amount), [100.42, 78]);
  assert.equal(priced.total, 22.42);
});

test("unpriceable payments return null", () => {
  const cad = [{ amount: 17.68, currency: "CAD" }];
  assert.equal(priceLegs({ legs: cad, paidCurrency: "HKD", rates: {} }), null);
  assert.equal(priceLegs({ legs: cad, paidCurrency: "HKD", rates: { CAD: 0 } }), null);
  // Nets the other way.
  assert.equal(
    priceLegs({
      legs: [{ amount: 5, currency: "CAD" }, { amount: 10, currency: "CAD", reverse: true }],
      paidCurrency: "HKD",
      rates: { CAD: 5.68 },
    }),
    null,
  );
  // HK$0.01 is less than ¥1.
  assert.equal(priceLegs({ legs: [{ amount: 0.01, currency: "HKD" }], paidCurrency: "JPY", rates: { HKD: 19.5 } }), null);
});

test("shownRate reads back the simplest rate that reproduces the amounts", () => {
  assert.equal(shownRate(17.68, 100.42, "HKD"), 5.68);
  assert.equal(shownRate(17.68, 100, "HKD"), 5.656);
  assert.equal(shownRate(27.68, 157.22, "HKD"), 5.68);
  assert.equal(shownRate(100, 1953, "JPY"), 19.53);
  assert.equal(shownRate(90, 15.84, "CAD"), 0.176);
  assert.equal(shownRate(0, 10, "HKD"), null);
});

/* ------------------------------- form state ------------------------------- */

test("startPaid: home currency at the latest daily rate", () => {
  assert.deepEqual(startPaid("CAD", fx), { currency: "HKD", rate: "5.6789", received: "", source: "rate" });
  // A debt already in HKD has no obvious other currency.
  assert.deepEqual(startPaid("HKD", fx), { currency: "", rate: "", received: "", source: "rate" });
  // Keeps a chosen currency when the debt's currency changes…
  assert.equal(startPaid("CAD", fx, "USD").currency, "USD");
  assert.equal(startPaid("CAD", fx, "USD").rate, rateInput(5.6789 / 7.7712));
  // …unless it's now the same currency.
  assert.equal(startPaid("USD", fx, "USD").currency, "HKD");
});

test("resolvePaid: a typed rate sets what's received, a typed amount sets the rate", () => {
  const legs = [{ amount: 17.68, currency: "CAD" }];
  const byRate = ok(resolvePaid({ currency: "HKD", rate: "5.68", received: "", source: "rate" }, legs));
  assert.equal(byRate.total, 100.42);
  assert.equal(byRate.rate, 5.68);
  // The prefilled daily rate.
  assert.equal(ok(resolvePaid(startPaid("CAD", fx), legs)).total, 100.4); // 17.68 × 5.6789 = 100.403
  const byAmount = ok(resolvePaid({ currency: "HKD", rate: "5.68", received: "100", source: "received" }, legs));
  assert.equal(byAmount.total, 100);
  assert.equal(byAmount.rate, 5.656);
  assert.equal(byAmount.legs[0].paid_amount, 100);
});

test("resolvePaid splits what was sent across trip parts", () => {
  const legs = [{ amount: 17.68, currency: "CAD" }, { amount: 10, currency: "CAD" }];
  const priced = ok(resolvePaid({ currency: "HKD", rate: "5.68", received: "", source: "rate" }, legs));
  assert.equal(priced.total, 157.22);
  assert.deepEqual(priced.legs.map((l) => l.paid_amount), [100.42, 56.8]);
});

test("resolvePaid explains what's missing", () => {
  const legs = [{ amount: 17.68, currency: "CAD" }];
  assert.equal(resolvePaid(null, legs), null);
  assert.equal(resolvePaid(startPaid("CAD", fx), null), null);
  assert.match(errorOf(resolvePaid({ currency: "", rate: "", received: "", source: "rate" }, legs))!, /Pick the currency/);
  assert.match(errorOf(resolvePaid({ currency: "CAD", rate: "1", received: "", source: "rate" }, legs))!, /other than CAD/);
  assert.match(errorOf(resolvePaid({ currency: "HKD", rate: "", received: "", source: "rate" }, legs))!, /Enter the rate/);
  assert.match(errorOf(resolvePaid({ currency: "HKD", rate: "5", received: "0", source: "received" }, legs))!, /amount received/);
  assert.match(
    errorOf(resolvePaid({ currency: "JPY", rate: "19.5", received: "", source: "rate" }, [{ amount: 0.01, currency: "HKD" }]))!,
    /too small/,
  );
});

/* -------------------------------- balances -------------------------------- */

const member = (id: string, trip_id: string) => ({ id, name: id, trip_id, party_id: null });
/** A CAD dinner `payer` paid, split evenly. */
const dinner = (id: string, trip_id: string, payer: string, amount: number, among: string[]) => ({
  id,
  trip_id,
  amount,
  currency: "CAD",
  paid_by: payer,
  splits: among.map((user_id) => ({ user_id, weight: 1, extra_amount: 0, paid_amount: 0 })),
});
const netsOf = (data: Parameters<typeof computeBalances>[0]) =>
  Object.fromEntries(
    computeBalances(data).units.map((u) => [
      u.key,
      Object.fromEntries(
        Object.entries(u.net as Record<string, number>)
          .filter(([, v]) => Math.abs(v) >= 0.005)
          .map(([c, v]) => [c, Math.round(v * 100) / 100]),
      ),
    ]),
  );

test("a CAD debt paid in HKD clears the CAD balance exactly and leaves HKD untouched", () => {
  const data = {
    members: [member("alice", T1), member("sophie", T1)],
    parties: [],
    bookings: [],
    expenses: [dinner("e1", T1, "sophie", 35.36, ["alice", "sophie"])],
    settlements: [] as Array<Record<string, unknown>>,
  };
  assert.deepEqual(netsOf(data), { alice: { CAD: -17.68 }, sophie: { CAD: 17.68 } });

  const priced = ok(resolvePaid({ currency: "HKD", rate: "5.68", received: "", source: "rate" }, [{ amount: 17.68, currency: "CAD" }]));
  const paidInHkd = {
    ...data,
    settlements: [{
      id: "s1", trip_id: T1, from_user: "alice", to_user: "sophie",
      amount: 17.68, currency: "CAD", paid_currency: priced.paidCurrency, paid_amount: priced.total,
    }],
  };
  assert.deepEqual(netsOf(paidInHkd), { alice: {}, sophie: {} });
  assert.deepEqual(computeBalances(paidInHkd).pairTransfers, []);
  assert.deepEqual(suggestTransfers(computeBalances(paidInHkd).units), []);

  // Why it isn't recorded as a HKD payment: that leaves the CAD debt standing
  // and makes Sophie owe Alice HK$100.42.
  const asHkdPayment = {
    ...data,
    settlements: [{ id: "s1", trip_id: T1, from_user: "alice", to_user: "sophie", amount: 100.42, currency: "HKD" }],
  };
  assert.deepEqual(netsOf(asHkdPayment), { alice: { CAD: -17.68, HKD: 100.42 }, sophie: { CAD: 17.68, HKD: -100.42 } });
});

test("a multi-trip CAD transfer paid in HKD settles every trip, and the paid parts add up", () => {
  const data = {
    members: [member("alice", T1), member("sophie", T1), member("alice", T2), member("sophie", T2)],
    parties: [],
    bookings: [],
    expenses: [dinner("e1", T1, "sophie", 35.36, ["alice", "sophie"]), dinner("e2", T2, "sophie", 20, ["alice", "sophie"])],
    settlements: [] as Array<Record<string, unknown>>,
  };
  const parts = allocateTransfer({ ...data, fromKey: "alice", toKey: "sophie", currency: "CAD", amount: 27.68 })!;
  const priced = ok(resolvePaid(
    { currency: "HKD", rate: "5.68", received: "", source: "rate" },
    parts.map((p) => ({ ...p, currency: "CAD" })),
  ));
  const rows = parts.map((p, i) => ({
    id: `s${i}`, trip_id: p.trip_id, from_user: p.from_user, to_user: p.to_user,
    amount: p.amount, currency: "CAD", group_id: "g", paid_currency: "HKD", paid_amount: priced.legs[i].paid_amount,
  }));
  const after = { ...data, settlements: rows };
  for (const t of [T1, T2]) {
    const only = (r: { trip_id: string }) => r.trip_id === t;
    assert.deepEqual(
      netsOf({
        members: after.members.filter(only), parties: [], bookings: [],
        expenses: after.expenses.filter(only), settlements: after.settlements.filter(only),
      }),
      { alice: {}, sophie: {} },
      `trip ${t} should be settled`,
    );
  }
  assert.deepEqual(netsOf(after), { alice: {}, sophie: {} });

  // The Payments list reads the group as one payment.
  const { fromUser, toUser, settled, paid } = summarizePayment(rows);
  assert.deepEqual(
    { fromUser, toUser, settled, paid },
    {
      fromUser: "alice",
      toUser: "sophie",
      settled: [{ currency: "CAD", amount: 27.68 }],
      paid: { currency: "HKD", amount: 157.22, rate: 5.68 },
    },
  );
});

/* ------------------------------ Payments list ----------------------------- */

test("summarizePayment: plain, paid in another currency, both-way groups and partial views", () => {
  const row = (over: Record<string, unknown>) => ({
    from_user: "alice", to_user: "bob", amount: 0, currency: "HKD", paid_currency: null, paid_amount: null, ...over,
  });
  const plain = summarizePayment([row({ amount: 50 })]);
  assert.deepEqual([plain.fromUser, plain.toUser, plain.settled, plain.paid], ["alice", "bob", [{ currency: "HKD", amount: 50 }], null]);

  const paid = summarizePayment([row({ amount: 17.68, currency: "CAD", paid_currency: "HKD", paid_amount: 100.42 })]);
  assert.deepEqual(paid.paid, { currency: "HKD", amount: 100.42, rate: 5.68 });

  // Japan 80 + Korea 40 one way, Taiwan 30 back; paid in CAD.
  const group = [
    row({ amount: 80, paid_currency: "CAD", paid_amount: 14.08 }),
    row({ amount: 40, paid_currency: "CAD", paid_amount: 7.04 }),
    row({ from_user: "bob", to_user: "alice", amount: 30, paid_currency: "CAD", paid_amount: 5.28 }),
  ];
  const whole = summarizePayment(group);
  assert.deepEqual([whole.fromUser, whole.settled, whole.paid], ["alice", [{ currency: "HKD", amount: 90 }], { currency: "CAD", amount: 15.84, rate: 0.176 }]);
  assert.deepEqual(group.map((r) => whole.sign(r)), [1, 1, -1]);

  // Only Taiwan selected: its part reads in its own direction.
  const taiwan = summarizePayment([group[2]]);
  assert.deepEqual([taiwan.fromUser, taiwan.toUser, taiwan.settled, taiwan.paid!.amount], ["bob", "alice", [{ currency: "HKD", amount: 30 }], 5.28]);
});

/* -------------------------------- validation ------------------------------ */

test("settlement schema: paid currency and amount go together and differ from the currency settled", () => {
  const base = {
    trip_id: T1, from_user: "alice", to_user: "sophie", amount: 17.68, currency: "CAD",
  };
  const parse = (over: Record<string, unknown>) => settlementInsertSchema.safeParse({ ...base, ...over }).success;
  assert.equal(parse({}), true);
  assert.equal(parse({ paid_currency: "HKD", paid_amount: 100.42 }), true);
  assert.equal(parse({ paid_currency: null, paid_amount: null }), true);
  assert.equal(parse({ paid_currency: "HKD" }), false);
  assert.equal(parse({ paid_amount: 100.42 }), false);
  assert.equal(parse({ paid_currency: "CAD", paid_amount: 17.68 }), false);
  assert.equal(parse({ paid_currency: "HKD", paid_amount: 0 }), false);
  assert.equal(parse({ paid_currency: "XYZ", paid_amount: 5 }), false);
});

test("group schema: one paid currency for the payment, an amount on every part", () => {
  const part = (n: number, paid_amount?: number) => ({
    id: `10000000-0000-4000-8000-00000000000${n}`,
    trip_id: n === 1 ? T1 : T2,
    from_user: "alice", to_user: "sophie", amount: 10,
    ...(paid_amount === undefined ? {} : { paid_amount }),
  });
  const base = { group_id: "20000000-0000-4000-8000-000000000001", currency: "CAD" };
  const parse = (over: Record<string, unknown>) => settlementGroupInsertSchema.safeParse({ ...base, ...over }).success;
  assert.equal(parse({ parts: [part(1), part(2)] }), true);
  assert.equal(parse({ paid_currency: "HKD", parts: [part(1, 56.8), part(2, 56.8)] }), true);
  // A tiny part may round to nothing, as long as something was paid.
  assert.equal(parse({ paid_currency: "HKD", parts: [part(1, 56.8), part(2, 0)] }), true);
  assert.equal(parse({ paid_currency: "HKD", parts: [part(1, 0), part(2, 0)] }), false);
  assert.equal(parse({ paid_currency: "HKD", parts: [part(1, 56.8), part(2)] }), false);
  assert.equal(parse({ parts: [part(1, 56.8), part(2, 56.8)] }), false);
  assert.equal(parse({ paid_currency: "CAD", parts: [part(1, 10), part(2, 10)] }), false);
});
