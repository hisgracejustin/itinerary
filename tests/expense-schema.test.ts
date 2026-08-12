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
  splits: [{ user_id: "payer", weight: 1, extra_amount: 0, paid_amount: 0 }],
};

test("expense creation requires a YYYY-MM-DD date", () => {
  assert.equal(expenseInsertSchema.safeParse(validExpense).success, true);
  assert.equal(expenseInsertSchema.safeParse({ ...validExpense, date: undefined }).success, false);
  assert.equal(expenseInsertSchema.safeParse({ ...validExpense, date: "08/08/2026" }).success, false);
  assert.equal(expenseInsertSchema.safeParse({ ...validExpense, date: "2026-02-29" }).success, false);
});

test("expense updates may omit but cannot clear the date", () => {
  assert.equal(expenseUpdateSchema.safeParse({ title: "Coffee beans" }).success, true);
  assert.equal(expenseUpdateSchema.safeParse({ date: null }).success, false);
  assert.equal(expenseUpdateSchema.safeParse({ date: "2026-08-09" }).success, true);
});

test("expense category defaults to other and only accepts known values", () => {
  const defaulted = expenseInsertSchema.safeParse(validExpense);
  assert.equal(defaulted.success, true);
  assert.equal(defaulted.data!.category, "other");
  assert.equal(expenseInsertSchema.safeParse({ ...validExpense, category: "food" }).success, true);
  assert.equal(expenseInsertSchema.safeParse({ ...validExpense, category: "Food" }).success, false);
  assert.equal(expenseInsertSchema.safeParse({ ...validExpense, category: "lodging" }).success, false);
});

test("expense updates may omit but cannot clear the category", () => {
  assert.equal(expenseUpdateSchema.safeParse({ title: "Coffee beans" }).success, true);
  assert.equal(expenseUpdateSchema.safeParse({ category: "transport" }).success, true);
  assert.equal(expenseUpdateSchema.safeParse({ category: null }).success, false);
  assert.equal(expenseUpdateSchema.safeParse({ category: "" }).success, false);
});

test("expense creation rejects paid separately contributions above its amount", () => {
  const result = expenseInsertSchema.safeParse({
    ...validExpense,
    splits: [{
      user_id: "payer",
      weight: 1,
      extra_amount: 0,
      paid_amount: 14.01,
    }],
  });
  assert.equal(result.success, false);
  assert.match(result.error!.issues[0].message, /cannot exceed/i);
});
