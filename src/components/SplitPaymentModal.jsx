"use client";

import { useMemo, useRef, useState } from "react";
import FormModal from "./FormModal";
import { allocateTransferByTrip } from "../lib/split";
import { formatCurrency } from "../lib/currencies";
import { recordSettlement, recordSettlementGroup } from "../lib/client-actions";
import { friendlyError } from "../lib/friendlyError";
import { useToast } from "./Toast";
import { useTripContext } from "../lib/trip-context";

const cleanAmount = (raw) => String(raw).replace(/[^0-9.]/g, "");

/**
 * Settle a transfer that spans several trips in one go. The payment is split
 * per trip (allocateTransferByTrip) and recorded as one row per trip under a
 * shared group id, so each trip's balance stays right on its own while the
 * Payments list shows a single payment.
 *
 * @param {{ transfer: any, initialAmount: string, data: any, onClose: () => void }} props
 */
export default function SplitPaymentModal({ transfer, initialAmount, data, onClose }) {
  const { trips } = useTripContext();
  const { toast } = useToast();
  const formRef = useRef(null);
  // Ids are minted once per distinct split, so a retry of the same submission
  // lands on the rows it already wrote — but editing the amount after a failed
  // attempt gets fresh ids rather than colliding with a different split.
  const idsRef = useRef({ signature: null, group_id: null, ids: [] });
  const savingRef = useRef(false);
  const [amount, setAmount] = useState(initialAmount);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const { fromUnit, toUnit, currency } = transfer;
  const total = Number.parseFloat(amount);
  const parts = useMemo(
    () =>
      total > 0
        ? allocateTransferByTrip({
            ...data,
            fromKey: fromUnit.key,
            toKey: toUnit.key,
            currency,
            amount: total,
          })
        : null,
    [data, fromUnit.key, toUnit.key, currency, total],
  );
  const tripName = (id) => trips.find((trip) => trip.id === id)?.name ?? "Trip";

  const submit = async (event) => {
    event.preventDefault();
    if (savingRef.current) return;
    if (!(total > 0)) return toast.error("Enter an amount");
    if (!parts?.length) return toast.error("Couldn't split this payment across trips");
    const signature = JSON.stringify(parts);
    if (idsRef.current.signature !== signature) {
      idsRef.current = {
        signature,
        group_id: crypto.randomUUID(),
        ids: parts.map(() => crypto.randomUUID()),
      };
    }
    const { group_id, ids } = idsRef.current;
    savingRef.current = true;
    setSaving(true);
    try {
      const trimmed = note.trim() || null;
      if (parts.length === 1) {
        // A small amount can round every other trip's share to nothing.
        const [part] = parts;
        await recordSettlement({
          id: ids[0],
          trip_id: part.trip_id,
          from_user: part.from_user,
          to_user: part.to_user,
          amount: part.amount,
          currency,
          note: trimmed,
        });
      } else {
        await recordSettlementGroup({
          group_id,
          currency,
          note: trimmed,
          parts: parts.map((part, i) => ({
            id: ids[i],
            trip_id: part.trip_id,
            from_user: part.from_user,
            to_user: part.to_user,
            amount: part.amount,
          })),
        });
      }
      toast.success("Payment recorded");
      onClose();
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <FormModal
      title="Settle across trips"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="mat-btn-outlined">Cancel</button>
          <button
            type="button"
            onClick={() => formRef.current?.requestSubmit()}
            disabled={saving || !parts?.length}
            className="mat-btn-filled disabled:opacity-40"
          >
            {saving ? "Recording…" : "Record payment"}
          </button>
        </div>
      }
    >
      <form ref={formRef} onSubmit={submit} className="space-y-4">
        <div className="text-sm text-on-surface">
          <span className="font-medium">{fromUnit.name}</span>
          <span className="text-on-surface-variant"> → </span>
          <span className="font-medium">{toUnit.name}</span>
        </div>
        <div className="flex gap-2 items-center">
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(cleanAmount(event.target.value))}
            placeholder="Amount"
            aria-label="Amount"
            className="mat-input flex-1"
          />
          <span className="text-sm font-medium text-on-surface-variant shrink-0">{currency}</span>
        </div>
        <div>
          <div className="text-[11px] font-medium text-on-surface-variant uppercase tracking-wide mb-1">
            Recorded per trip
          </div>
          {parts?.length ? (
            <ul className="space-y-1" data-testid="split-payment-parts">
              {parts.map((part) => (
                <li key={part.trip_id} className="flex justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-on-surface">
                    {tripName(part.trip_id)}
                    {part.reverse && (
                      <span className="text-on-surface-variant">
                        {" "}· {toUnit.name} → {fromUnit.name}
                      </span>
                    )}
                  </span>
                  <span className="font-medium text-on-surface shrink-0">
                    {part.reverse ? "−" : ""}
                    {formatCurrency(part.amount, currency)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {parts?.some((part) => part.reverse) && (
            <p className="mt-2 text-xs text-on-surface-variant">
              In trips where {toUnit.name} owed {fromUnit.name}, that debt is recorded as paid so
              every trip ends settled; the total above is what changes hands.
            </p>
          )}
          {parts?.length ? null : (
            <p className="text-sm text-on-surface-variant">Enter an amount to see the split.</p>
          )}
        </div>
        <input
          type="text"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Note (optional)"
          className="mat-input"
        />
        <button type="submit" disabled={saving} className="hidden" />
      </form>
    </FormModal>
  );
}
