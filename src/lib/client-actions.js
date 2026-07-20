"use client";

// Thin client wrappers over the Server Actions: return data / throw a friendly
// error. The "use client" directive keeps the DB layer out of the browser bundle
// (the client → "use server" import is the RPC boundary). Each mutating action
// calls revalidatePath("/", "layout") server-side, so screens re-render from
// fresh server props — no client-side cache to keep in sync.
import {
  createBookingAction,
  updateBookingAction,
  deleteBookingAction,
} from "@/actions/bookings";
import { upsertDayNoteAction, deleteDayNoteAction } from "@/actions/dayNotes";
import {
  createDayReminderAction,
  updateDayReminderAction,
  deleteDayReminderAction,
  reorderDayRemindersAction,
} from "@/actions/dayReminders";
import { addTripMemberAction, removeTripMemberAction } from "@/actions/members";
import { unwrap } from "@/lib/friendlyError";

export const createBooking = async (booking) => unwrap(await createBookingAction(booking));
export const updateBooking = async (id, updates) => unwrap(await updateBookingAction(id, updates));
export const deleteBooking = async (id) => unwrap(await deleteBookingAction(id));

export const upsertDayNote = async (input) => unwrap(await upsertDayNoteAction(input));
export const deleteDayNote = async (id) => unwrap(await deleteDayNoteAction(id));

export const createDayReminder = async (input) => unwrap(await createDayReminderAction(input));
export const updateDayReminder = async (id, updates) => unwrap(await updateDayReminderAction(id, updates));
export const deleteDayReminder = async (id) => unwrap(await deleteDayReminderAction(id));
export const reorderDayReminders = async (ids) => unwrap(await reorderDayRemindersAction(ids));

export const addTripMember = async (input) => unwrap(await addTripMemberAction(input));
export const removeTripMember = async (input) => unwrap(await removeTripMemberAction(input));
