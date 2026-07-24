import { requirePageUser } from "@/lib/page-auth";
import {
  getBookingsForUser,
  getDayNotesForUser,
  getDayRemindersForUser,
  getTodosForUser,
} from "@/lib/queries";
import Calendar from "@/screens/Calendar";

export const dynamic = "force-dynamic";

// Trip selection is client state (see TripContext): every page loads the union
// of the user's trips — the same payload the All Trips view always shipped —
// and the screens filter it by the current selection, so toggling a trip is
// one instant client render with no navigation or refetch.
export default async function CalendarRoute() {
  const user = await requirePageUser();
  const [bookings, todos, dayNotes, dayReminders] = await Promise.all([
    getBookingsForUser(user.id, null),
    getTodosForUser(user.id, null),
    getDayNotesForUser(user.id, null),
    getDayRemindersForUser(user.id, null),
  ]);
  return (
    <Calendar
      initialBookings={bookings}
      initialTodos={todos}
      initialDayNotes={dayNotes}
      initialDayReminders={dayReminders}
    />
  );
}
