import test from "node:test";
import assert from "node:assert/strict";
import {
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
