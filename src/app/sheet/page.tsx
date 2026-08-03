import { requirePageUser } from "@/lib/page-auth";
import {
  getAttachmentsForUser,
  getBookingsForUser,
  getDayNotesForUser,
  getDayRemindersForUser,
  getTodosForUser,
  getTripsWithMembers,
} from "@/lib/queries";
import DaySheet from "@/screens/DaySheet";

export const dynamic = "force-dynamic";

/**
 * The offline day sheet — deliberately OUTSIDE the (app) group: no AppShell, no
 * sidebar, no header. Everything the screen can ever show is fetched here and
 * embedded in the props, so the rendered document needs no further network at
 * all; that self-containment is what lets the service worker cache this one
 * response and still serve a usable itinerary with no connection.
 */
export default async function SheetRoute() {
  const user = await requirePageUser();
  const [trips, bookings, todos, dayNotes, dayReminders, attachments] = await Promise.all([
    getTripsWithMembers(user.id),
    getBookingsForUser(user.id, null),
    getTodosForUser(user.id, null),
    getDayNotesForUser(user.id, null),
    getDayRemindersForUser(user.id, null),
    getAttachmentsForUser(user.id, null),
  ]);

  const now = new Date();
  // This server runs on UTC, and a trip's end_date is a naive local day — from
  // ~17:00 in Vancouver UTC is already tomorrow, which deselected the trip the
  // reader was standing in and left the sheet showing "No trips selected". One
  // day of slack covers the ~26h of real-world skew in either direction. The
  // sheet is an offline convenience surface: over-including a trip that ended
  // yesterday costs a line in the picker, while under-including one costs a
  // traveller with no signal their entire itinerary.
  const activeFrom = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
  return (
    <DaySheet
      trips={trips}
      bookings={bookings}
      todos={todos}
      dayNotes={dayNotes}
      dayReminders={dayReminders}
      attachments={attachments}
      generatedAt={now.toISOString()}
      // The default trip selection ("still running") is decided server-side so
      // the cached HTML and its hydration agree on where the cut-off fell.
      activeFrom={activeFrom}
    />
  );
}
