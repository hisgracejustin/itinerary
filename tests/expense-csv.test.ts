import test from "node:test";
import assert from "node:assert/strict";
import { buildExpensesCsv } from "../src/lib/expense-csv.js";

const trip = {
  id: "trip-1",
  name: "Canada",
  members: [
    { id: "adri", name: "Adri" },
    { id: "justin", name: "Justin" },
    { id: "michelle", name: "Michelle" },
  ],
};

test("exports essential expense and exact split information", () => {
  const csv = buildExpensesCsv(
    [
      {
        id: "expense-1",
        trip_id: "trip-1",
        title: 'Coffee, "large"',
        date: "2026-08-07",
        amount: 14,
        currency: "CAD",
        category: "food",
        paid_by: "adri",
        created_by: "justin",
        created_at: "2026-08-07T18:00:00.000Z",
        charged_currency: "USD",
        charged_rate: 0.75,
        splits: [
          { user_id: "adri", weight: 1, extra_amount: 0, paid_amount: 0 },
          { user_id: "justin", weight: 1, extra_amount: 0, paid_amount: 2 },
          { user_id: "michelle", weight: 0, extra_amount: 0, paid_amount: 0 },
        ],
      },
    ],
    [trip],
  );

  assert.equal(csv.split("\r\n").length, 2);
  assert.match(csv, /"Trip","Date","Expense","Category","Amount","Currency","Paid by"/);
  assert.match(csv, /"Coffee, ""large""","Food & drink"/);
  assert.match(csv, /"Adri; Justin; Michelle"/);
  assert.match(csv, /"Adri: 7\.00 CAD, weight 1; Justin: 7\.00 CAD, weight 1, paid separately 2\.00 CAD; Michelle: 0\.00 CAD, weight 0"/);
  assert.match(csv, /"USD","0\.75","10\.5","Justin","2026-08-07T18:00:00\.000Z","expense-1"/);
});

test("exports only the expense rows supplied by the filtered Settle view", () => {
  const csv = buildExpensesCsv(
    [{
      id: "visible",
      trip_id: "trip-1",
      title: "Visible expense",
      amount: 5,
      currency: "CAD",
      splits: [{ user_id: "justin", weight: 1, extra_amount: 0 }],
    }],
    [trip],
  );

  // No category on the row — pre-column expenses export as Other, not blank.
  assert.match(csv, /"Visible expense","Other"/);
  assert.doesNotMatch(csv, /Hidden expense/);
  assert.equal(csv.split("\r\n").length, 2);
});

test("neutralizes spreadsheet formulas in user-entered cells", () => {
  const csv = buildExpensesCsv(
    [{
      id: "formula",
      trip_id: "trip-1",
      title: "=HYPERLINK(\"https://example.com\")",
      amount: 1,
      currency: "CAD",
      splits: [{ user_id: "justin", weight: 1, extra_amount: 0 }],
    }],
    [trip],
  );

  assert.match(csv, /"'=HYPERLINK\(""https:\/\/example\.com""\)"/);
});

test("exports the charge inputs and each person's pre-charge amount", () => {
  const csv = buildExpensesCsv(
    [
      {
        id: "expense-2",
        trip_id: "trip-1",
        title: "Drinks",
        date: "2026-08-07",
        amount: 29.2,
        currency: "CAD",
        paid_by: "adri",
        created_by: "adri",
        created_at: "2026-08-07T18:00:00.000Z",
        service_percent: 5,
        shared_charge: 4,
        splits: [
          { user_id: "adri", weight: 0, extra_amount: 15.85, paid_amount: 0, base_amount: 14.14 },
          { user_id: "justin", weight: 0, extra_amount: 13.35, paid_amount: 0, base_amount: 11.76 },
        ],
      },
    ],
    [trip],
  );
  const [header, row] = csv.split("\r\n");
  assert.ok(header.includes('"Service %","Shared charge"'));
  assert.ok(row.includes('"5","4"'));
  assert.ok(row.includes("before charges 14.14 CAD"));
});
