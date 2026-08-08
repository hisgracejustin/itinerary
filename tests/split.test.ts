import test from "node:test";
import assert from "node:assert/strict";
import {
  applyItemCharges,
  computeBalances,
  itemFunding,
  itemShares,
  itemViewerNet,
} from "../src/lib/split.js";

const trip_id = "00000000-0000-4000-8000-000000000001";
const members = [
  { id: "main", name: "Main", trip_id, party_id: null },
  { id: "other", name: "Other", trip_id, party_id: null },
  { id: "third", name: "Third", trip_id, party_id: null },
];
const splits = [
  { user_id: "main", weight: 1, extra_amount: 0, paid_amount: 0 },
  { user_id: "other", weight: 1, extra_amount: 0, paid_amount: 5 },
  { user_id: "third", weight: 1, extra_amount: 0, paid_amount: 0 },
];

test("$105 split credits the main payer $100 and another contributor $5", () => {
  const shares = itemShares(105, splits);
  assert.deepEqual([...shares!], [
    ["main", 35],
    ["other", 35],
    ["third", 35],
  ]);

  assert.deepEqual([...itemFunding(105, "main", splits)!], [
    ["other", 5],
    ["main", 100],
  ]);

  const result = computeBalances({
    members,
    parties: [],
    bookings: [{
      id: "booking",
      trip_id,
      cost_amount: 105,
      cost_currency: "USD",
      cost_share: 1,
      paid_by: "main",
      splits,
    }],
    expenses: [],
    settlements: [],
  });
  const byKey = new Map(result.units.map((unit) => [unit.key, unit]));
  const usd = (value: object) => (value as Record<string, number>).USD;
  assert.equal(usd(byKey.get("main")!.paid), 100);
  assert.equal(usd(byKey.get("main")!.owed), 35);
  assert.equal(usd(byKey.get("main")!.net), 65);
  assert.equal(usd(byKey.get("other")!.paid), 5);
  assert.equal(usd(byKey.get("other")!.owed), 35);
  assert.equal(usd(byKey.get("other")!.net), -30);
  assert.equal(usd(byKey.get("third")!.owed), 35);
  assert.equal(usd(byKey.get("third")!.net), -35);
  assert.equal(
    result.units.reduce((sum, unit) => sum + (usd(unit.net) || 0), 0),
    0,
  );
  assert.equal(itemViewerNet({
    amount: 105,
    paidBy: "main",
    splits,
    unitMemberIds: ["other"],
  }), -30);
});

test("funding rejects contributions above the item amount", () => {
  assert.equal(itemFunding(105, "main", [
    { user_id: "other", weight: 1, extra_amount: 0, paid_amount: 105.01 },
  ]), null);
});

test("a shared fixed charge skips people with no amount of their own", () => {
  // Cat, Justin and Michelle order; Wendy orders; Wai is only in the split
  // because "Wai & Wendy" is one settlement party. The $4 charge is four ways.
  const rows = ["cat", "justin", "michelle", "wendy", "wai"].map((user_id) => ({
    user_id,
    weight: 0,
    extra_amount: 0,
    paid_amount: 0,
  }));
  const charged = applyItemCharges({
    splits: rows,
    bases: { cat: 6, justin: 8, michelle: 5, wendy: 5, wai: 0 },
    servicePercent: 5,
    sharedCharge: 4,
  });
  const by = new Map(charged.map((row) => [row.user_id, row.extra_amount]));
  assert.equal(by.get("wai"), 0);
  assert.equal(by.get("wendy"), 5 * 1.05 + 1);
  assert.equal(by.get("justin"), 8 * 1.05 + 1);
  assert.equal(
    charged.reduce((sum, row) => sum + row.extra_amount, 0),
    24 * 1.05 + 4,
  );
  assert.deepEqual(charged.map((row) => row.weight), [0, 0, 0, 0, 0]);
});

test("charges recompute from bases instead of compounding on the last result", () => {
  const rows = [{ user_id: "cat", weight: 0, extra_amount: 0, paid_amount: 0 }];
  const bases = { cat: 10 };
  const once = applyItemCharges({ splits: rows, bases, servicePercent: 10, sharedCharge: 2 });
  const twice = applyItemCharges({ splits: once, bases, servicePercent: 10, sharedCharge: 2 });
  assert.equal(once[0].extra_amount, 13);
  assert.equal(twice[0].extra_amount, 13);
});

test("a shared charge with no amounts entered yet divides across everyone", () => {
  const rows = ["a", "b"].map((user_id) => ({ user_id, weight: 0, extra_amount: 0, paid_amount: 0 }));
  const charged = applyItemCharges({ splits: rows, bases: {}, sharedCharge: 5 });
  assert.deepEqual(charged.map((row) => row.extra_amount), [2.5, 2.5]);
});
