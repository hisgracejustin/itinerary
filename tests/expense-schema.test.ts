import test from "node:test";
import assert from "node:assert/strict";
import { expenseInsertSchema, expenseUpdateSchema } from "../src/lib/schemas.js";

const validExpense = {
  trip_id: "00000000-0000-4000-8000-000000000001",
  title: "Coffee",
  amount: 14,
  currency: "CAD",
  paid_by: "payer",
  date: "2026-08-08",
  splits: [{ user_id: "payer", weight: 1, extra_amount: 0 }],
};

test("expense creation requires a YYYY-MM-DD date", () => {
  assert.equal(expenseInsertSchema.safeParse(validExpense).success, true);
  assert.equal(expenseInsertSchema.safeParse({ ...validExpense, date: undefined }).success, false);
  assert.equal(expenseInsertSchema.safeParse({ ...validExpense, date: "08/08/2026" }).success, false);
});

test("expense updates may omit but cannot clear the date", () => {
  assert.equal(expenseUpdateSchema.safeParse({ title: "Coffee beans" }).success, true);
  assert.equal(expenseUpdateSchema.safeParse({ date: null }).success, false);
  assert.equal(expenseUpdateSchema.safeParse({ date: "2026-08-09" }).success, true);
});
