"use client";

import { useState } from "react";
import ExpenseModal from "../components/ExpenseModal";
import { useTripContext } from "../lib/trip-context";
import { buildExpensesCsv } from "../lib/expense-csv";
import { formatCurrency } from "../lib/currencies";
import { itemViewerNet } from "../lib/split";
import { isTripWritable, writableTripsInSelection } from "../lib/trip-permissions";

// Same zero-decimal set the settle math special-cases, used here only to hide
// dust on the per-expense "what this does to you" pill.
const ZERO_DECIMAL = ["JPY", "KRW", "TWD"];
const epsFor = (currency) => (ZERO_DECIMAL.includes(currency) ? 1 : 0.01);

const todayIso = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

/** "Today" / "Yesterday" / "Sat, Aug 8" for a "YYYY-MM-DD" expense date. */
const dayLabel = (iso) => {
  if (!iso) return "No date";
  const today = todayIso();
  if (iso === today) return "Today";
  const yesterday = new Date(`${today}T00:00:00`);
  yesterday.setDate(yesterday.getDate() - 1);
  if (iso === yesterday.toISOString().slice(0, 10)) return "Yesterday";
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  const opts = { weekday: "short", month: "short", day: "numeric" };
  if (iso.slice(0, 4) !== today.slice(0, 4)) opts.year = "numeric";
  return date.toLocaleDateString(undefined, opts);
};

/** Sum amounts per currency — expense totals never cross-convert. */
const totalsByCurrency = (rows) => {
  const totals = new Map();
  for (const row of rows) {
    totals.set(row.currency, (totals.get(row.currency) || 0) + (Number(row.amount) || 0));
  }
  return [...totals].map(([currency, amount]) => formatCurrency(amount, currency)).join(" · ");
};

export default function Expenses({ expenses: allExpenses, currentUserId }) {
  const { trips, selectedTrips, selectedTrip } = useTripContext();
  const [modal, setModal] = useState(null);
  const [query, setQuery] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const selected = new Set(selectedTrips);
  const scoped = selectedTrips.length
    ? allExpenses.filter((expense) => selected.has(expense.trip_id))
    : allExpenses;
  const tripById = new Map(trips.map((trip) => [trip.id, trip]));
  const writableTrips = trips.filter(isTripWritable);
  const writableScopedTrips = writableTripsInSelection(trips, selectedTrips);

  const nameFor = (expense, userId) => {
    const member = tripById.get(expense.trip_id)?.members?.find((item) => item.id === userId);
    return member?.name?.trim() || member?.email || "Someone";
  };

  // The viewer's settlement unit inside a trip: them plus anyone sharing their
  // party there — mirrors Settle.jsx, so the pills agree with the balances.
  const viewerUnitIds = (tripId) => {
    const roster = tripById.get(tripId)?.members || [];
    const me = roster.find((member) => member.id === currentUserId);
    if (!me?.party_id) return [currentUserId];
    return roster.filter((member) => member.party_id === me.party_id).map((member) => member.id);
  };
  // What one expense alone does to the viewer's balance, in the currency it
  // settles in (its charged currency when it carries one, else native).
  const viewerNet = (expense) => {
    if (!currentUserId) return null;
    const net = itemViewerNet({
      amount: Number(expense.amount) || 0,
      paidBy: expense.paid_by,
      splits: expense.splits || [],
      unitMemberIds: viewerUnitIds(expense.trip_id),
    });
    if (net == null) return null;
    const rate = Number(expense.charged_rate);
    return expense.charged_currency && rate > 0
      ? { net: net * rate, currency: expense.charged_currency }
      : { net, currency: expense.currency };
  };

  const needsAttention = (expense) =>
    !expense.paid_by ? "No payer" : (expense.splits || []).length === 0 ? "Not split" : null;

  const isMine = (expense) =>
    expense.paid_by === currentUserId ||
    (expense.splits || []).some((split) => split.user_id === currentUserId);

  const needle = query.trim().toLowerCase();
  const expenses = scoped
    .filter((expense) => {
      if (mineOnly && !isMine(expense)) return false;
      if (!needle) return true;
      const haystack = [
        expense.title,
        tripById.get(expense.trip_id)?.name,
        expense.paid_by ? nameFor(expense, expense.paid_by) : "",
      ];
      return haystack.some((value) => (value || "").toLowerCase().includes(needle));
    })
    // Newest first; created_at breaks ties inside a day so same-day entries read
    // in reverse order of entry.
    .sort(
      (a, b) =>
        (b.date || "").localeCompare(a.date || "") ||
        new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime(),
    );

  // Consecutive runs of one date — the list is already sorted, so a run break
  // is simply a change of date.
  const days = [];
  for (const expense of expenses) {
    const last = days[days.length - 1];
    if (last && last.date === expense.date) last.rows.push(expense);
    else days.push({ date: expense.date, rows: [expense] });
  }

  const exportCsv = () => {
    const blob = new Blob([`\uFEFF${buildExpensesCsv(expenses, trips)}`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `expenses-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const filtered = mineOnly || needle;

  return (
    <div className="w-full max-w-5xl mx-auto space-y-4">
      <section className="mat-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-on-surface">Expenses</h2>
            <p className="text-xs text-on-surface-variant mt-0.5">
              {expenses.length} expense{expenses.length === 1 ? "" : "s"}
              {expenses.length > 0 && ` · ${totalsByCurrency(expenses)}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={exportCsv}
              disabled={expenses.length === 0}
              className="mat-btn-outlined text-xs disabled:opacity-40"
            >
              Export CSV
            </button>
            {writableScopedTrips.length > 0 && (
              <button
                type="button"
                onClick={() => setModal({ expense: null, availableTrips: writableScopedTrips })}
                className="mat-btn-filled text-xs"
              >
                + Add expense
              </button>
            )}
          </div>
        </div>

        {scoped.length > 0 && (
          <div className="flex items-center gap-2 mb-3">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search expenses, payer, trip…"
              aria-label="Search expenses"
              className="mat-input flex-1 min-w-0 text-sm"
            />
            <button
              type="button"
              onClick={() => setMineOnly((value) => !value)}
              aria-pressed={mineOnly}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                mineOnly
                  ? "border-primary bg-primary-light text-primary"
                  : "border-outline/30 text-on-surface-variant hover:bg-surface-container"
              }`}
            >
              Only mine
            </button>
          </div>
        )}

        {expenses.length === 0 ? (
          <div className="rounded-xl bg-surface-container/50 px-4 py-8 text-center">
            <p className="text-sm text-on-surface">
              {filtered ? "No expenses match this filter." : "No expenses in these trips yet."}
            </p>
            <p className="text-xs text-on-surface-variant mt-1">
              {filtered
                ? "Try a different search, or turn off “Only mine”."
                : "Add dinners, taxis, coffee, and other shared costs."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {days.map(({ date, rows }) => (
              <div key={date || "undated"}>
                <div className="flex items-baseline justify-between gap-3 border-b border-outline/20 pb-1 mb-0.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant truncate min-w-0">
                    {dayLabel(date)}
                  </span>
                  <span className="text-[11px] text-on-surface-variant/70 shrink-0">
                    {totalsByCurrency(rows)}
                  </span>
                </div>
                <div className="divide-y divide-outline/10">
                  {rows.map((expense) => {
                    const trip = tripById.get(expense.trip_id);
                    const splitNames = (expense.splits || []).map((split) =>
                      nameFor(expense, split.user_id),
                    );
                    const editable = isTripWritable(trip);
                    const attention = needsAttention(expense);
                    const mine = viewerNet(expense);
                    const showNet = mine && Math.abs(mine.net) >= epsFor(mine.currency);
                    return (
                      <button
                        key={expense.id}
                        type="button"
                        disabled={!editable}
                        onClick={() => editable && setModal({ expense, availableTrips: writableTrips })}
                        className={`w-full flex items-center gap-3 py-3 text-left ${editable ? "hover:bg-surface-container/50 cursor-pointer" : "cursor-default"} transition-colors`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2 min-w-0">
                            <span className="text-sm font-medium text-on-surface truncate min-w-0">
                              {expense.title}
                            </span>
                            {trip && (
                              <span className="text-[10px] text-on-surface-variant bg-surface-container rounded-full px-2 py-0.5 truncate max-w-36 shrink-0">
                                {trip.name}
                              </span>
                            )}
                            {attention && (
                              <span className="text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 shrink-0">
                                {attention}
                              </span>
                            )}
                          </span>
                          <span className="block text-xs text-on-surface-variant truncate mt-0.5">
                            {expense.paid_by ? `${nameFor(expense, expense.paid_by)} paid` : "No payer"}
                            {splitNames.length ? ` · Split: ${splitNames.join(", ")}` : " · Not split"}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-sm font-semibold text-on-surface">
                            {formatCurrency(Number(expense.amount) || 0, expense.currency)}
                          </span>
                          {showNet && (
                            <span
                              className={`block text-[11px] font-medium ${mine.net > 0 ? "text-emerald-700" : "text-red-600"}`}
                            >
                              {mine.net > 0 ? "+" : "−"}
                              {formatCurrency(Math.abs(mine.net), mine.currency)}
                            </span>
                          )}
                        </span>
                        {editable && (
                          <svg
                            className="w-4 h-4 text-on-surface-variant shrink-0"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 18l6-6-6-6" />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {modal && (
        <ExpenseModal
          key={modal.expense?.id || "new"}
          expense={modal.expense}
          selectedTrip={
            selectedTrip && modal.availableTrips.some((trip) => trip.id === selectedTrip)
              ? selectedTrip
              : null
          }
          availableTrips={modal.availableTrips}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
