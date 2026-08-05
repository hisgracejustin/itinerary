import test from "node:test";
import assert from "node:assert/strict";
import { optionInsertSchema } from "../src/lib/schemas";

const valid = {
  id: "11111111-1111-4111-8111-111111111111",
  option_set_id: "set-1",
  title: "Hotel",
  cost_amount: 100,
  cost_currency: "HKD",
};

test("accepts an idempotency UUID and safe web URL", () => {
  const parsed = optionInsertSchema.parse({ ...valid, url: "https://example.com/hotel" });
  assert.equal(parsed.id, valid.id);
  assert.equal(parsed.url, "https://example.com/hotel");
});

test("rejects unsafe URLs, negative costs, and unsupported currencies", () => {
  assert.equal(optionInsertSchema.safeParse({ ...valid, url: "javascript:alert(1)" }).success, false);
  assert.equal(optionInsertSchema.safeParse({ ...valid, cost_amount: -1 }).success, false);
  assert.equal(optionInsertSchema.safeParse({ ...valid, cost_currency: "NOPE" }).success, false);
});

test("generic option writes cannot set pick state or sort order", () => {
  const parsed = optionInsertSchema.parse({
    ...valid,
    is_pick: true,
    sort_order: -100,
  });
  assert.equal("is_pick" in parsed, false);
  assert.equal("sort_order" in parsed, false);
});
