"use client";

import { useState } from "react";
import ExpenseModal from "../components/ExpenseModal";
import { useTripContext } from "../lib/trip-context";
import { buildExpensesCsv } from "../lib/expense-csv";
import { formatCurrency } from "../lib/currencies";
import { isTripWritable, writableTripsInSelection } from "../lib/trip-permissions";

export default function Expenses({ expenses: allExpenses }) {
  const { trips, selectedTrips, selectedTrip } = useTripContext();
  const [modal, setModal] = useState(null);
  const selected = new Set(selectedTrips);
  const expenses = selectedTrips.length
    ? allExpenses.filter((expense) => selected.has(expense.trip_id))
    : allExpenses;
  const tripById = new Map(trips.map((trip) => [trip.id, trip]));
  const writableTrips = trips.filter(isTripWritable);
  const writableScopedTrips = writableTripsInSelection(trips, selectedTrips);

  const nameFor = (expense, userId) => {
    const member = tripById.get(expense.trip_id)?.members?.find((item) => item.id === userId);
    return member?.name?.trim() || member?.email || "Someone";
  };

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

  return (
    <div className="w-full max-w-5xl mx-auto space-y-4">
      <section className="mat-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-semibold text-on-surface">Expenses</h2>
            <p className="text-xs text-on-surface-variant mt-0.5">
              {expenses.length} expense{expenses.length === 1 ? "" : "s"} in the current trip filter
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

        {expenses.length === 0 ? (
          <div className="rounded-xl bg-surface-container/50 px-4 py-8 text-center">
            <p className="text-sm text-on-surface">No expenses in these trips yet.</p>
            <p className="text-xs text-on-surface-variant mt-1">Add dinners, taxis, coffee, and other shared costs.</p>
          </div>
        ) : (
          <div className="divide-y divide-outline/20">
            {expenses.map((expense) => {
              const trip = tripById.get(expense.trip_id);
              const splitNames = (expense.splits || []).map((split) => nameFor(expense, split.user_id));
              const editable = isTripWritable(trip);
              return (
                <button
                  key={expense.id}
                  type="button"
                  disabled={!editable}
                  onClick={() => editable && setModal({ expense, availableTrips: writableTrips })}
                  className={`w-full flex items-center gap-3 py-3 text-left ${editable ? "hover:bg-surface-container/50 cursor-pointer" : "cursor-default"} transition-colors`}
                >
                  <span className="text-xl shrink-0" aria-hidden>🧾</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium text-on-surface truncate">{expense.title}</span>
                      {trip && (
                        <span className="text-[10px] text-on-surface-variant bg-surface-container rounded-full px-2 py-0.5 truncate max-w-36">
                          {trip.name}
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-on-surface-variant truncate mt-0.5">
                      {expense.paid_by ? `${nameFor(expense, expense.paid_by)} paid` : "No payer"}
                      {expense.date ? ` · ${expense.date}` : ""}
                      {splitNames.length ? ` · Split: ${splitNames.join(", ")}` : " · Not split"}
                    </span>
                  </span>
                  <span className="text-sm font-semibold text-on-surface shrink-0">
                    {formatCurrency(Number(expense.amount) || 0, expense.currency)}
                  </span>
                  {editable && (
                    <svg className="w-4 h-4 text-on-surface-variant shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 18l6-6-6-6" />
                    </svg>
                  )}
                </button>
              );
            })}
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
