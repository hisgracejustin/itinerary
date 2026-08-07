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
        paid_by: "adri",
        created_by: "justin",
        created_at: "2026-08-07T18:00:00.000Z",
        charged_currency: "USD",
        charged_rate: 0.75,
        splits: [
          { user_id: "adri", weight: 1, extra_amount: 0 },
          { user_id: "justin", weight: 1, extra_amount: 0 },
          { user_id: "michelle", weight: 0, extra_amount: 0 },
        ],
      },
    ],
    [trip],
  );

  assert.equal(csv.split("\r\n").length, 2);
  assert.match(csv, /"Trip","Date","Expense","Amount","Currency","Paid by"/);
  assert.match(csv, /"Coffee, ""large"""/);
  assert.match(csv, /"Adri; Justin; Michelle"/);
  assert.match(csv, /"Adri: 7\.00 CAD, weight 1; Justin: 7\.00 CAD, weight 1; Michelle: 0\.00 CAD, weight 0"/);
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

  assert.match(csv, /Visible expense/);
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
