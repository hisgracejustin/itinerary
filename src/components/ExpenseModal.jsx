"use client";

import { useRef, useState } from "react";
import FormModal from "./FormModal";
import TripSelect from "./TripSelect";
import SplitEditor from "./SplitEditor";
import ChargedRateEditor from "./ChargedRateEditor";
import { CURRENCIES } from "../lib/currencies";
import { pruneEmptySplits } from "../lib/split";
import { createExpense, deleteExpense, updateExpense } from "../lib/client-actions";
import { friendlyError } from "../lib/friendlyError";
import { useToast } from "./Toast";
import { useConfirmDanger } from "./ConfirmDanger";
import { useTripContext } from "../lib/trip-context";

const cleanAmount = (raw) => String(raw).replace(/[^0-9.]/g, "");
const toNumber = (raw) => {
  const value = parseFloat(cleanAmount(raw));
  return Number.isFinite(value) ? value : NaN;
};

const initialForm = (expense, selectedTrip) => ({
  trip_id: expense?.trip_id || selectedTrip || "",
  title: expense?.title || "",
  amount: expense?.amount != null ? String(expense.amount) : "",
  currency: expense?.currency || "HKD",
  date: expense?.date || "",
  paid_by: expense?.paid_by ?? null,
  splits: (expense?.splits || []).map((split) => ({
    user_id: split.user_id,
    weight: Number.isFinite(Number(split.weight)) ? Number(split.weight) : 1,
    extra_amount: Number(split.extra_amount) || 0,
  })),
  charged_currency: expense?.charged_currency || "",
  charged_rate: expense?.charged_rate != null ? String(expense.charged_rate) : "",
});

/**
 * @param {{ expense?: any, selectedTrip?: string | null, onClose: () => void }} props
 */
export default function ExpenseModal({ expense = null, selectedTrip = null, onClose }) {
  const { trips } = useTripContext();
  const { toast } = useToast();
  const { ask, dialog } = useConfirmDanger();
  const formRef = useRef(null);
  const [form, setForm] = useState(() => initialForm(expense, selectedTrip));
  const [saving, setSaving] = useState(false);

  const trip = trips.find((item) => item.id === form.trip_id);
  const roster = trip?.members || [];
  const parties = trip?.parties || [];

  const changeTrip = (trip_id) => {
    const ids = new Set((trips.find((item) => item.id === trip_id)?.members || []).map((member) => member.id));
    setForm((current) => ({
      ...current,
      trip_id,
      splits: current.splits.filter((split) => ids.has(split.user_id)),
      paid_by: current.paid_by && ids.has(current.paid_by) ? current.paid_by : null,
    }));
  };

  const submit = async (event) => {
    event.preventDefault();
    const amount = toNumber(form.amount);
    const splits = pruneEmptySplits(form.splits);
    if (!form.trip_id) return toast.error("Pick a trip for this expense");
    if (!form.title.trim()) return toast.error("Give the expense a title");
    if (!(amount > 0)) return toast.error("Enter an amount");
    if (splits.length === 0) return toast.error("Split the expense between at least one person");
    if (!form.paid_by) return toast.error("Pick who paid");
    const sumExtras = splits.reduce((sum, row) => sum + (Number(row.extra_amount) || 0), 0);
    if (sumExtras > amount + 0.01) return toast.error("Extras exceed the total cost");
    if (form.charged_currency) {
      if (!(toNumber(form.charged_rate) > 0)) return toast.error("Enter the rate it was charged at");
      if (form.charged_currency === form.currency) {
        return toast.error("Charged currency must differ from the expense currency");
      }
    }
    const hasCharge = !!form.charged_currency && toNumber(form.charged_rate) > 0;
    const payload = {
      trip_id: form.trip_id,
      title: form.title.trim(),
      amount,
      currency: form.currency,
      date: form.date || null,
      paid_by: form.paid_by,
      splits,
      charged_currency: hasCharge ? form.charged_currency : null,
      charged_rate: hasCharge ? toNumber(form.charged_rate) : null,
    };

    setSaving(true);
    try {
      if (expense?.id) await updateExpense(expense.id, payload);
      else await createExpense(payload);
      toast.success(expense?.id ? "Expense updated" : "Expense added");
      onClose();
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!expense?.id) return;
    const ok = await ask({
      title: "Delete this expense?",
      message: `"${expense.title}" will be permanently removed. This cannot be undone.`,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    setSaving(true);
    try {
      await deleteExpense(expense.id);
      toast.success("Expense deleted");
      onClose();
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {dialog}
      <FormModal
        title={expense?.id ? "Edit expense" : "New expense"}
        onClose={onClose}
        footer={
          <div className="flex items-center justify-between gap-3">
            <div>
              {expense?.id && (
                <button type="button" onClick={remove} disabled={saving} className="text-sm text-red-600 disabled:opacity-40">
                  Delete expense
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="mat-btn-outlined">Cancel</button>
              <button
                type="button"
                onClick={() => formRef.current?.requestSubmit()}
                disabled={saving}
                className="mat-btn-filled disabled:opacity-40"
              >
                {saving ? "Saving…" : expense?.id ? "Save expense" : "Add expense"}
              </button>
            </div>
          </div>
        }
      >
        <form ref={formRef} onSubmit={submit} className="space-y-4">
          <TripSelect trips={trips} value={form.trip_id} onChange={changeTrip} />
          <input
            type="text"
            value={form.title}
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
            placeholder="What was it? (dinner, taxi…)"
            className="mat-input"
          />
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="decimal"
              value={form.amount}
              onChange={(event) => setForm((current) => ({ ...current, amount: cleanAmount(event.target.value) }))}
              placeholder="Amount"
              className="mat-input flex-1"
            />
            <select
              value={form.currency}
              onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value }))}
              aria-label="Currency"
              className="mat-select shrink-0"
            >
              {CURRENCIES.map((currency) => (
                <option key={currency.code} value={currency.code}>{currency.code}</option>
              ))}
            </select>
          </div>
          <label className="block">
            <span className="text-[11px] font-medium text-on-surface-variant uppercase tracking-wide block mb-1">
              Date (optional)
            </span>
            <input
              type="date"
              value={form.date}
              onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
              className="mat-input"
            />
          </label>
          {form.trip_id ? (
            <SplitEditor
              members={roster}
              parties={parties}
              amount={toNumber(form.amount) || 0}
              currency={form.currency}
              paidBy={form.paid_by}
              splits={form.splits}
              onChange={({ paid_by, splits }) => setForm((current) => ({ ...current, paid_by, splits }))}
            />
          ) : (
            <p className="text-xs text-on-surface-variant">Pick a trip to split this expense.</p>
          )}
          <ChargedRateEditor
            nativeCurrency={form.currency}
            effective={toNumber(form.amount) || 0}
            chargedCurrency={form.charged_currency}
            chargedRate={form.charged_rate}
            onChange={({ charged_currency, charged_rate }) =>
              setForm((current) => ({
                ...current,
                charged_currency: charged_currency ?? "",
                charged_rate: charged_rate ?? "",
              }))
            }
          />
          <button type="submit" className="hidden" />
        </form>
      </FormModal>
    </>
  );
}
