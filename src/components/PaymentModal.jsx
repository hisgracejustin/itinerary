"use client";

import { useRef, useState } from "react";
import FormModal from "./FormModal";
import TripSelect from "./TripSelect";
import AssigneePicker from "./AssigneePicker";
import { CURRENCIES } from "../lib/currencies";
import { recordSettlement } from "../lib/client-actions";
import { friendlyError } from "../lib/friendlyError";
import { useToast } from "./Toast";
import { useTripContext } from "../lib/trip-context";

const cleanAmount = (raw) => String(raw).replace(/[^0-9.]/g, "");

export default function PaymentModal({ selectedTrip = null, onClose }) {
  const { trips } = useTripContext();
  const { toast } = useToast();
  const formRef = useRef(null);
  const idRef = useRef(null);
  const [form, setForm] = useState({
    trip_id: selectedTrip || "",
    from_user: null,
    to_user: null,
    amount: "",
    currency: "HKD",
    note: "",
  });
  const [saving, setSaving] = useState(false);

  const roster = trips.find((trip) => trip.id === form.trip_id)?.members || [];
  const from = roster.find((member) => member.id === form.from_user);
  const recipients = roster.filter((member) => {
    if (member.id === form.from_user) return false;
    return !(from?.party_id && member.party_id === from.party_id);
  });

  const submit = async (event) => {
    event.preventDefault();
    const amount = Number.parseFloat(form.amount);
    if (!form.trip_id) return toast.error("Pick a trip for this payment");
    if (!form.from_user || !form.to_user) return toast.error("Pick who paid and who received");
    if (!(amount > 0)) return toast.error("Enter an amount");
    if (!idRef.current) idRef.current = crypto.randomUUID();
    setSaving(true);
    try {
      await recordSettlement({
        id: idRef.current,
        trip_id: form.trip_id,
        from_user: form.from_user,
        to_user: form.to_user,
        amount,
        currency: form.currency,
        note: form.note.trim() || null,
      });
      toast.success("Payment recorded");
      onClose();
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      title="Record a payment"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="mat-btn-outlined">Cancel</button>
          <button
            type="button"
            onClick={() => formRef.current?.requestSubmit()}
            disabled={saving}
            className="mat-btn-filled disabled:opacity-40"
          >
            {saving ? "Recording…" : "Record payment"}
          </button>
        </div>
      }
    >
      <form ref={formRef} onSubmit={submit} className="space-y-4">
        <TripSelect
          trips={trips}
          value={form.trip_id}
          onChange={(trip_id) => setForm((current) => ({
            ...current,
            trip_id,
            from_user: null,
            to_user: null,
          }))}
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-on-surface-variant">From (paid)</span>
          <AssigneePicker
            value={form.from_user}
            members={roster}
            onChange={(member) => setForm((current) => ({
              ...current,
              from_user: member?.id ?? null,
              to_user: null,
            }))}
            align="right"
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-on-surface-variant">To (received)</span>
          <AssigneePicker
            value={form.to_user}
            members={recipients}
            onChange={(member) => setForm((current) => ({ ...current, to_user: member?.id ?? null }))}
            align="right"
          />
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
            onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value }))}
            aria-label="Currency"
            className="mat-select shrink-0"
          >
            {CURRENCIES.map((currency) => (
              <option key={currency.code} value={currency.code}>{currency.code}</option>
            ))}
          </select>
        </div>
        <input
          type="text"
          value={form.note}
          onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
          placeholder="Note (optional)"
          className="mat-input"
        />
        <button type="submit" className="hidden" />
      </form>
    </FormModal>
  );
}
