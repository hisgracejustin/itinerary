"use client";

import { useRef, useState } from "react";
import FormModal from "./FormModal";
import TripSelect from "./TripSelect";
import AssigneePicker from "./AssigneePicker";
import { createTodo } from "../lib/client-actions";
import { friendlyError } from "../lib/friendlyError";
import { useToast } from "./Toast";
import { useTripContext } from "../lib/trip-context";

/**
 * @param {{ selectedTrip?: string | null, availableTrips?: any[] | null, currentUserId: string, onClose: () => void }} props
 */
export default function TodoModal({ selectedTrip = null, availableTrips = null, currentUserId, onClose }) {
  const { trips } = useTripContext();
  const tripOptions = availableTrips ?? trips;
  const defaultTrip =
    selectedTrip && tripOptions.some((trip) => trip.id === selectedTrip)
      ? selectedTrip
      : tripOptions.length === 1
        ? tripOptions[0].id
        : "";
  const { toast } = useToast();
  const formRef = useRef(null);
  const savingRef = useRef(false);
  const [form, setForm] = useState({
    title: "",
    trip_id: defaultTrip,
    due_date: "",
    assignee_id: null,
  });
  const [saving, setSaving] = useState(false);
  const members = trips.find((trip) => trip.id === form.trip_id)?.members || [];

  const submit = async (event) => {
    event.preventDefault();
    if (savingRef.current) return;
    if (!form.title.trim()) return toast.error("Enter what needs to be done");
    if (!form.trip_id) return toast.error("Pick a trip for this to-do");
    savingRef.current = true;
    setSaving(true);
    try {
      await createTodo({
        title: form.title.trim(),
        trip_id: form.trip_id,
        due_date: form.due_date || null,
        assignee_id: form.assignee_id,
      });
      toast.success("To-do added");
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
      title="New to-do"
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
            {saving ? "Adding…" : "Add to-do"}
          </button>
        </div>
      }
    >
      <form ref={formRef} onSubmit={submit} className="space-y-4">
        <input
          type="text"
          value={form.title}
          onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
          placeholder="What needs to be done?"
          className="mat-input"
          autoFocus
        />
        <TripSelect
          trips={tripOptions}
          value={form.trip_id}
          onChange={(trip_id) => setForm((current) => ({ ...current, trip_id, assignee_id: null }))}
        />
        <label className="block">
          <span className="text-[11px] font-medium text-on-surface-variant uppercase tracking-wide block mb-1">
            Due date (optional)
          </span>
          <input
            type="date"
            value={form.due_date}
            onChange={(event) => setForm((current) => ({ ...current, due_date: event.target.value }))}
            className="mat-input"
          />
        </label>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-on-surface-variant">Assign to</span>
          <AssigneePicker
            value={form.assignee_id}
            members={members}
            currentUserId={currentUserId}
            onChange={(member) => setForm((current) => ({ ...current, assignee_id: member?.id ?? null }))}
            align="right"
          />
        </div>
        <button type="submit" disabled={saving} className="hidden" />
      </form>
    </FormModal>
  );
}
