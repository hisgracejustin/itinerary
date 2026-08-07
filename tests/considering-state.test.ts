import test from "node:test";
import assert from "node:assert/strict";
import { mergeConsideringSets, sortOptionsByPrice, summarizePrices } from "../src/lib/considering-state.js";

const set = (options: unknown[]) => ({ id: "set-1", title: "Decision", options });
const option = (id: string, images: unknown[] = []) => ({ id, title: id, images });

test("server omissions delete stale local options and images", () => {
  const local = [set([option("gone"), option("kept", [{ id: "stale-image" }])])];
  const server = [set([option("kept", [])])];

  const merged = mergeConsideringSets(local, server);

  assert.deepEqual(merged[0].options, [option("kept", [])]);
});

test("only explicitly pending options survive an in-flight server snapshot", () => {
  const local = [
    set([
      option("pending-new", [{ id: "local-image" }]),
      option("stale-local"),
      option("existing", [{ id: "pending-image" }]),
    ]),
  ];
  const server = [set([option("existing", [{ id: "server-image" }])])];

  const merged = mergeConsideringSets(
    local,
    server,
    new Set(["pending-new", "existing"]),
  );

  assert.deepEqual(
    merged[0].options.map((item: { id: string }) => item.id),
    ["existing", "pending-new"],
  );
  assert.deepEqual(
    merged[0].options[0].images.map((image: { id: string }) => image.id),
    ["server-image", "pending-image"],
  );
});

test("sorts priced options in either direction and leaves unpriced options last", () => {
  const options = [
    { id: "unpriced", cost_amount: null },
    { id: "high", cost_amount: "250.00" },
    { id: "low", cost_amount: "80.00" },
    { id: "invalid", cost_amount: "unknown" },
  ];

  assert.deepEqual(
    sortOptionsByPrice(options, "asc").map((item: { id: string }) => item.id),
    ["low", "high", "unpriced", "invalid"],
  );
  assert.deepEqual(
    sortOptionsByPrice(options, "desc").map((item: { id: string }) => item.id),
    ["high", "low", "unpriced", "invalid"],
  );
  assert.deepEqual(
    sortOptionsByPrice(options, null).map((item: { id: string }) => item.id),
    ["unpriced", "high", "low", "invalid"],
  );
});

test("summarizePrices: fewer than two priced options is not comparable", () => {
  const summary = summarizePrices([{ id: "a", cost_amount: "100", cost_currency: "HKD" }]);
  assert.equal(summary.comparable, false);
  assert.equal(summary.cheapestIds.size, 0);
  assert.equal(summary.deltas.size, 0);
});

test("summarizePrices: mixed currencies is not comparable", () => {
  const summary = summarizePrices([
    { id: "a", cost_amount: "100", cost_currency: "HKD" },
    { id: "b", cost_amount: "50", cost_currency: "USD" },
  ]);
  assert.equal(summary.comparable, false);
});

test("summarizePrices: a tie at the minimum both get the cheapest badge", () => {
  const summary = summarizePrices([
    { id: "a", cost_amount: "100", cost_currency: "HKD" },
    { id: "b", cost_amount: "100", cost_currency: "HKD" },
    { id: "c", cost_amount: "150", cost_currency: "HKD" },
  ]);
  assert.equal(summary.comparable, true);
  assert.deepEqual([...summary.cheapestIds].sort(), ["a", "b"]);
  assert.equal(summary.deltas.get("a"), 0);
  assert.equal(summary.deltas.get("b"), 0);
  assert.equal(summary.deltas.get("c"), 50);
});

test("summarizePrices: unpriced options are excluded from deltas", () => {
  const summary = summarizePrices([
    { id: "a", cost_amount: "100", cost_currency: "HKD" },
    { id: "b", cost_amount: null, cost_currency: "HKD" },
    { id: "c", cost_amount: "200", cost_currency: "HKD" },
  ]);
  assert.equal(summary.comparable, true);
  assert.equal(summary.deltas.has("b"), false);
  assert.equal(summary.deltas.get("c"), 100);
});

test("summarizePrices: correct deltas against the cheapest", () => {
  const summary = summarizePrices([
    { id: "a", cost_amount: "80", cost_currency: "HKD" },
    { id: "b", cost_amount: "125.50", cost_currency: "HKD" },
  ]);
  assert.equal(summary.comparable, true);
  assert.deepEqual([...summary.cheapestIds], ["a"]);
  assert.equal(summary.deltas.get("a"), 0);
  assert.equal(summary.deltas.get("b"), 45.5);
});
