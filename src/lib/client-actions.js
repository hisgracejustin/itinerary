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
  createTripAction,
  updateTripAction,
  deleteTripAction,
} from "@/actions/bookings";
import { upsertDayNoteAction, deleteDayNoteAction } from "@/actions/dayNotes";
import {
  createDayReminderAction,
  updateDayReminderAction,
  deleteDayReminderAction,
  reorderDayRemindersAction,
} from "@/actions/dayReminders";
import {
  addTripMemberAction,
  removeTripMemberAction,
  setTripMemberRoleAction,
  updateMemberProfileAction,
  setMemberPinAction,
  createPartyAction,
  renamePartyAction,
  deletePartyAction,
  setMemberPartyAction,
} from "@/actions/members";
import {
  createExpenseAction,
  updateExpenseAction,
  deleteExpenseAction,
} from "@/actions/expenses";
import { recordSettlementAction, deleteSettlementAction } from "@/actions/settle";
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

export const createTrip = async (input) => unwrap(await createTripAction(input));
export const updateTrip = async (id, updates) => unwrap(await updateTripAction(id, updates));
export const deleteTrip = async (id) => unwrap(await deleteTripAction(id));

export const addTripMember = async (input) => unwrap(await addTripMemberAction(input));
export const removeTripMember = async (input) => unwrap(await removeTripMemberAction(input));
export const setTripMemberRole = async (input) => unwrap(await setTripMemberRoleAction(input));
export const updateMemberProfile = async (input) => unwrap(await updateMemberProfileAction(input));
export const setMemberPin = async (input) => unwrap(await setMemberPinAction(input));

export const createParty = async (input) => unwrap(await createPartyAction(input));
export const renameParty = async (input) => unwrap(await renamePartyAction(input));
export const deleteParty = async (input) => unwrap(await deletePartyAction(input));
export const setMemberParty = async (input) => unwrap(await setMemberPartyAction(input));

export const createExpense = async (input) => unwrap(await createExpenseAction(input));
export const updateExpense = async (id, updates) => unwrap(await updateExpenseAction(id, updates));
export const deleteExpense = async (id) => unwrap(await deleteExpenseAction(id));

export const recordSettlement = async (input) => unwrap(await recordSettlementAction(input));
export const deleteSettlement = async (id) => unwrap(await deleteSettlementAction(id));
