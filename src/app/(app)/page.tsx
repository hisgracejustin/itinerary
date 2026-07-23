import { requirePageUser } from "@/lib/page-auth";
import {
  getBookingsForUser,
  getDayNotesForUser,
  getDayRemindersForUser,
  getTodosForUser,
} from "@/lib/queries";
import { parseTripParam, tripKey } from "@/lib/trip-params";
import Calendar from "@/screens/Calendar";

export const dynamic = "force-dynamic";

export default async function CalendarRoute({
  searchParams,
}: {
  searchParams: Promise<{ trip?: string | string[] }>;
}) {
  const { trip } = await searchParams;
  const tripIds = parseTripParam(trip);
  const user = await requirePageUser();
  const [bookings, todos, dayNotes, dayReminders] = await Promise.all([
    getBookingsForUser(user.id, tripIds),
    getTodosForUser(user.id, tripIds),
    getDayNotesForUser(user.id, tripIds),
    getDayRemindersForUser(user.id, tripIds),
  ]);
  return (
    <Calendar
      key={tripKey(tripIds)}
      initialBookings={bookings}
      initialTodos={todos}
      initialDayNotes={dayNotes}
      initialDayReminders={dayReminders}
    />
  );
}
