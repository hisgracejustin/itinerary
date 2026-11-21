import test from "node:test";
import assert from "node:assert/strict";
import { buildTripSummary } from "../src/lib/trip-summary.js";
import { breakPoints, renderTripSummaryPdf } from "../src/lib/trip-summary-pdf";

// The PDF's layout branches: everything in one currency (no ≈, no currency
// card), a settle-up list long enough to run onto page 2 with a full-width
// payments list, and a trip with nothing in it yet.

const T = "t1";
const member = (id: string, name: string, party_id: string | null = null) => ({ id, name, email: `${id}@test.dev`, trip_id: T, party_id });
const split = (ids: string[]) => ids.map((user_id) => ({ user_id, weight: 1, extra_amount: 0, paid_amount: 0 }));
const expense = (id: string, title: string, category: string, date: string, amount: number, currency: string, paid_by: string, among: string[]) => ({
  id, trip_id: T, title, category, date, amount, currency, paid_by, splits: split(among), charged_currency: null, charged_rate: null,
});
const base = { parties: [], bookings: [], settlements: [], rates: { USD: 7.7821, EUR: 8.41 }, rateDate: "2026-09-18", rateBasis: "trip-end" as const, preparedBy: "Alice Chan", generatedOn: "2026-11-21", timeZone: "Asia/Hong_Kong" };
const pages = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;

test("long words get break points, never right after their own hyphen", () => {
  assert.deepEqual(breakPoints("Montgomery-Smith"), ["Montgomery-Smith"]);
  assert.deepEqual(breakPoints("Konstantinopoulou-Whitfield"), ["Konstantin", "opoulou-Whitfield"]);
  assert.deepEqual(breakPoints("陳大文陳大文陳大文陳大文陳大文陳大文"), ["陳大文陳大文陳大文陳大文陳大文陳大文"]);
});

test("renders every layout branch", async () => {
  const ids = ["a", "b", "c", "d", "e", "f"];
  const names = ["Alice Chan", "Bob Lee", "Sophie Wong", "陳大文", "Emma Davies", "Alexandria Konstantinopoulou-Whitfield"];
  const cur = ["USD", "EUR", "HKD", "USD", "EUR"];
  const busy = buildTripSummary({
    ...base,
    trip: { name: "Europe & New York", start_date: "2026-09-01", end_date: "2026-09-20" },
    parties: [{ id: "pp", trip_id: T, name: "Bob & Sophie" }],
    members: ids.map((id, i) => member(id, names[i], id === "b" || id === "c" ? "pp" : null)),
    expenses: Array.from({ length: 14 }, (_, i) =>
      expense(`y${i}`, ["Louvre tickets", "Dinner", "Eurostar", "Broadway show", "Groceries"][i % 5], ["activities", "food", "transport", "activities", "groceries"][i % 5],
        `2026-09-${String(2 + i).padStart(2, "0")}`, [118.5, 1234.56, 12345.67, 987.65, 64.2][i % 5] * (1 + i / 10), cur[i % 5], ids[i % 6], ids)),
    settlements: Array.from({ length: 10 }, (_, i) => ({
      id: `p${i}`, trip_id: T, from_user: ids[(i + 1) % 6], to_user: ids[i % 6], amount: 50 + i, currency: cur[i % 5], note: null,
      paid_currency: null, paid_amount: null, created_at: `2026-09-${String(10 + i).padStart(2, "0")}T09:00:00Z`,
    })),
  });
  assert.ok(busy.settleUp.length > 6 && busy.payments.length > 8, "exercises the long-list layouts");
  const hkdOnly = buildTripSummary({
    ...base, rateBasis: "latest",
    trip: { name: "Lantau hike & BBQ", start_date: "2026-11-01", end_date: "2026-11-01" },
    members: [member("a", "Alice Chan"), member("b", "Bob Lee")],
    expenses: [expense("h1", "BBQ supplies", "groceries", "2026-11-01", 640, "HKD", "a", ["a", "b"])],
  });
  assert.equal(hkdOnly.rates.list.length, 0, "nothing to convert");
  const empty = buildTripSummary({ ...base, trip: { name: "Weekend away", start_date: "2026-12-01", end_date: "2026-12-03" }, members: [member("a", "Alice Chan")], expenses: [] });

  for (const [summary, min, max] of [[busy, 3, 8], [hkdOnly, 1, 3], [empty, 1, 1]] as const) {
    const pdf = await renderTripSummaryPdf(summary);
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    const n = pages(pdf);
    assert.ok(n >= min && n <= max, `${summary.trip.name}: ${n} pages`);
  }
});
