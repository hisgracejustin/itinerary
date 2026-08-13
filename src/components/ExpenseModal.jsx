"use client";

import { useRef, useState } from "react";
import FormModal from "./FormModal";
import TripSelect from "./TripSelect";
import SplitEditor from "./SplitEditor";
import AttachmentsSection from "./AttachmentsSection";
import ChargedRateEditor from "./ChargedRateEditor";
import ExpenseDetails from "./ExpenseDetails";
import { CURRENCIES, defaultCurrency } from "../lib/currencies";
import { EXPENSE_CATEGORIES, expenseCategory } from "../lib/expense-categories";
import { pruneEmptySplits } from "../lib/split";
import { createExpense, deleteExpense, updateExpense } from "../lib/client-actions";
import { friendlyError } from "../lib/friendlyError";
import { useToast } from "./Toast";
import { useConfirmDanger } from "./ConfirmDanger";
import { useTripContext } from "../lib/trip-context";

const LAST_EXPENSE_TRIP_KEY = "lastExpenseTrip";
const rememberedExpenseTrip = () => {
  try {
    return window.localStorage.getItem(LAST_EXPENSE_TRIP_KEY);
  } catch {
    return null;
  }
};
const cleanAmount = (raw) => String(raw).replace(/[^0-9.]/g, "");
const toNumber = (raw) => {
  const value = parseFloat(cleanAmount(raw));
  return Number.isFinite(value) ? value : NaN;
};
const todayLocal = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

const initialForm = (expense, selectedTrip, trip) => ({
  trip_id: expense?.trip_id || selectedTrip || "",
  title: expense?.title || "",
  // Normalized, not raw: a value retired from the list would otherwise leave
  // the picker with nothing selected and make every save fail validation,
  // including saves of unrelated fields.
  category: expenseCategory(expense?.category).value,
  amount: expense?.amount != null ? String(expense.amount) : "",
  currency: defaultCurrency(expense?.currency, trip),
  date: expense?.date || todayLocal(),
  paid_by: expense?.paid_by ?? null,
  splits: (expense?.splits || []).map((split) => ({
    user_id: split.user_id,
    weight: Number.isFinite(Number(split.weight)) ? Number(split.weight) : 1,
    extra_amount: Number(split.extra_amount) || 0,
    paid_amount: Number(split.paid_amount) || 0,
    base_amount: split.base_amount != null ? Number(split.base_amount) : null,
  })),
  // Already folded into the split rows; carried so the editor can show them.
  service_percent: expense?.service_percent != null ? Number(expense.service_percent) : null,
  shared_charge: expense?.shared_charge != null ? Number(expense.shared_charge) : null,
  charged_currency: expense?.charged_currency || "",
  charged_rate: expense?.charged_rate != null ? String(expense.charged_rate) : "",
});

/** Upload files staged before a new expense existed. Best-effort per file. */
async function uploadStagedFiles(expenseId, files) {
  for (const file of files) {
    const body = new FormData();
    body.append("expense_id", expenseId);
    body.append("file", file);
    const res = await fetch("/api/attachments", { method: "POST", body });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error || `Failed to attach ${file.name}`);
    }
  }
}

/**
 * @param {{ expense?: any, selectedTrip?: string | null, availableTrips?: any[] | null, onClose: () => void }} props
 */
export default function ExpenseModal({ expense = null, selectedTrip = null, availableTrips = null, onClose }) {
  const { trips } = useTripContext();
  const tripOptions = availableTrips ?? trips;
  const rememberedTrip = !expense && typeof window !== "undefined"
    ? rememberedExpenseTrip()
    : null;
  const defaultTrip =
    rememberedTrip && tripOptions.some((trip) => trip.id === rememberedTrip)
      ? rememberedTrip
      : selectedTrip && tripOptions.some((trip) => trip.id === selectedTrip)
      ? selectedTrip
      : tripOptions.length === 1
        ? tripOptions[0].id
        : null;
  const { toast } = useToast();
  const { ask, dialog } = useConfirmDanger();
  const formRef = useRef(null);
  const savingRef = useRef(false);
  const [form, setForm] = useState(() =>
    initialForm(expense, defaultTrip, trips.find((t) => t.id === (expense?.trip_id || defaultTrip))),
  );
  // Whether the currency was set by hand. Until it is, switching trips re-points
  // it at the new trip's currency; after it is, the choice sticks — a default
  // that overwrites what you just typed is worse than no default at all.
  const [currencyTouched, setCurrencyTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [stagedFiles, setStagedFiles] = useState([]); // attachments for a not-yet-saved expense
  // The expense as last saved — what view mode reads, updated in place after an
  // edit so the details refresh without waiting on a revalidation round-trip.
  const [current, setCurrent] = useState(expense);
  // Existing expense → read-only first, like a booking; brand-new → straight to
  // the form.
  const [editing, setEditing] = useState(!expense?.id);
  // A saved expense whose trip isn't among the writable options is view-only:
  // the pencil would open a form the server will reject, on a trip its own
  // select doesn't list. Viewing one is always fine.
  const canEdit = !current?.id || tripOptions.some((option) => option.id === current.trip_id);
  const viewMode = !!current?.id && (!editing || !canEdit);

  const trip = trips.find((item) => item.id === form.trip_id);
  const roster = trip?.members || [];
  const parties = trip?.parties || [];

  const changeTrip = (trip_id) => {
    if (!expense) {
      try {
        window.localStorage.setItem(LAST_EXPENSE_TRIP_KEY, trip_id);
      } catch {
        // Storage can be unavailable in private browsing; the form still works.
      }
    }
    const nextTrip = trips.find((item) => item.id === trip_id);
    const ids = new Set((nextTrip?.members || []).map((member) => member.id));
    setForm((current) => ({
      ...current,
      trip_id,
      // Follow the new trip's currency only while the field is untouched.
      currency: currencyTouched ? current.currency : defaultCurrency(null, nextTrip),
      splits: current.splits.filter((split) => ids.has(split.user_id)),
      paid_by: current.paid_by && ids.has(current.paid_by) ? current.paid_by : null,
    }));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (savingRef.current) return;
    const amount = toNumber(form.amount);
    const splits = pruneEmptySplits(form.splits);
    if (!form.trip_id) return toast.error("Pick a trip for this expense");
    if (!form.title.trim()) return toast.error("Give the expense a title");
    if (!(amount > 0)) return toast.error("Enter an amount");
    if (!form.date) return toast.error("Pick a date for this expense");
    if (splits.length === 0) return toast.error("Split the expense between at least one person");
    if (!form.paid_by) return toast.error("Pick who paid");
    const sumExtras = splits.reduce((sum, row) => sum + (Number(row.extra_amount) || 0), 0);
    const sumPaid = splits.reduce((sum, row) => sum + (Number(row.paid_amount) || 0), 0);
    const sumWeights = splits.reduce((sum, row) => sum + (Number(row.weight) || 0), 0);
    if (sumExtras > amount + 0.01) return toast.error("Extras exceed the total cost");
    if (sumPaid > amount + 1e-9) {
      return toast.error("Paid separately amounts exceed the total cost");
    }
    if (sumWeights <= 0 && Math.abs(sumExtras - amount) > 0.01) {
      return toast.error("Exact amounts must add up to the total");
    }
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
      category: form.category,
      amount,
      currency: form.currency,
      date: form.date,
      paid_by: form.paid_by,
      splits,
      service_percent: form.service_percent,
      shared_charge: form.shared_charge,
      charged_currency: hasCharge ? form.charged_currency : null,
      charged_rate: hasCharge ? toNumber(form.charged_rate) : null,
    };

    savingRef.current = true;
    setSaving(true);
    try {
      if (current?.id) {
        await updateExpense(current.id, payload);
        // Back to the read-only view showing what was just saved, rather than
        // closing — the details are what the modal was opened for, and the
        // props behind `expense` don't refresh until the page revalidates.
        setCurrent((row) => ({ ...row, ...payload }));
        setEditing(false);
        toast.success("Expense updated");
      } else {
        const saved = await createExpense(payload);
        if (saved?.id && stagedFiles.length > 0) {
          try {
            await uploadStagedFiles(saved.id, stagedFiles);
          } catch (error) {
            // The expense itself saved — surface the upload failure without
            // losing it, exactly as BookingModal does.
            toast.error(friendlyError(error));
          }
        }
        try {
          window.localStorage.setItem(LAST_EXPENSE_TRIP_KEY, form.trip_id);
        } catch {
          // Remembering the convenience default must never block a save.
        }
        toast.success("Expense added");
        onClose();
      }
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!current?.id) return;
    const ok = await ask({
      title: "Delete this expense?",
      message: `"${current.title}" will be permanently removed. This cannot be undone.`,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    setSaving(true);
    try {
      await deleteExpense(current.id);
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
        title={viewMode ? current.title || "Expense" : current?.id ? "Edit expense" : "New expense"}
        onClose={onClose}
        headerAction={
          viewMode && canEdit ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="mat-icon-btn shrink-0"
              title="Edit expense"
              aria-label="Edit expense"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          ) : null
        }
        footer={
          viewMode ? (
            <div className="flex justify-end">
              <button type="button" onClick={onClose} className="mat-btn-outlined">Close</button>
            </div>
          ) : (
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                {current?.id && (
                  <button type="button" onClick={remove} disabled={saving} className="text-sm text-red-600 disabled:opacity-40">
                    Delete expense
                  </button>
                )}
              </div>
              <div className="flex w-full gap-2 sm:w-auto">
                <button type="button" onClick={onClose} className="mat-btn-outlined flex-1 sm:flex-none">Cancel</button>
                <button
                  type="button"
                  onClick={() => formRef.current?.requestSubmit()}
                  disabled={saving}
                  className="mat-btn-filled flex-1 justify-center disabled:opacity-40 sm:flex-none"
                >
                  {saving ? "Saving…" : current?.id ? "Save expense" : "Add expense"}
                </button>
              </div>
            </div>
          )
        }
      >
        {viewMode ? (
          <div className="space-y-6">
            <ExpenseDetails expense={current} />
            <AttachmentsSection expenseId={current.id} mode="view" />
          </div>
        ) : (
        <form ref={formRef} onSubmit={submit} className="space-y-4">
          <TripSelect trips={tripOptions} value={form.trip_id} onChange={changeTrip} />
          <input
            type="text"
            value={form.title}
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
            placeholder="What was it? (dinner, taxi…)"
            className="mat-input"
          />
          {/* Scrolls rather than wraps — on a phone a wrapped chip row pushes
              the amount field below the fold. Written out instead of reusing
              FilterChip because that one has no type="button", and inside this
              form every chip would submit it. */}
          <div className="flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label="Category">
            {EXPENSE_CATEGORIES.map((option) => {
              const active = form.category === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setForm((current) => ({ ...current, category: option.value }))}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border whitespace-nowrap transition-colors shrink-0 ${
                    active
                      ? "bg-primary text-white border-primary"
                      : "bg-white text-on-surface-variant border-outline/30 hover:bg-surface-container"
                  }`}
                >
                  <span aria-hidden>{option.icon}</span>
                  {option.label}
                </button>
              );
            })}
          </div>
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
              onChange={(event) => {
                setCurrencyTouched(true);
                setForm((current) => ({ ...current, currency: event.target.value }));
              }}
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
              Date
            </span>
            <input
              type="date"
              required
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
              servicePercent={form.service_percent}
              sharedCharge={form.shared_charge}
              onChange={({ paid_by, splits, service_percent, shared_charge }) =>
                setForm((current) => ({
                  ...current,
                  paid_by,
                  splits,
                  service_percent,
                  shared_charge,
                }))
              }
            />
          ) : (
            <p className="text-xs text-on-surface-variant">Pick a trip to split this expense.</p>
          )}
          <div className="rounded-xl border border-outline/30 bg-surface-container/40 p-3">
            <AttachmentsSection
              expenseId={current?.id ?? null}
              mode="edit"
              stagedFiles={stagedFiles}
              setStagedFiles={setStagedFiles}
            />
          </div>
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
          <button type="submit" disabled={saving} className="hidden" />
        </form>
        )}
      </FormModal>
    </>
  );
}
