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
    bookings: [{
      id: "booking",
      trip_id,
      cost_amount: 105,
      cost_currency: "USD",
      cost_share: 1,
      paid_by: "main",
      splits,
    }],
  });
  const byKey = new Map(result.units.map((unit) => [unit.key, unit]));
  assert.equal(byKey.get("main")!.paid.USD, 100);
  assert.equal(byKey.get("main")!.owed.USD, 35);
  assert.equal(byKey.get("main")!.net.USD, 65);
  assert.equal(byKey.get("other")!.paid.USD, 5);
  assert.equal(byKey.get("other")!.owed.USD, 35);
  assert.equal(byKey.get("other")!.net.USD, -30);
  assert.equal(byKey.get("third")!.owed.USD, 35);
  assert.equal(byKey.get("third")!.net.USD, -35);
  assert.equal(
    result.units.reduce((sum, unit) => sum + (unit.net.USD || 0), 0),
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
