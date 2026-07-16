import { requirePageUser } from "@/lib/page-auth";
import {
  getBookingsForUser,
  getDayNotesForUser,
  getDayRemindersForUser,
  getTodosForUser,
} from "@/lib/queries";
import Calendar from "@/screens/Calendar";

export const dynamic = "force-dynamic";

export default async function CalendarRoute({
  searchParams,
}: {
  searchParams: Promise<{ trip?: string }>;
}) {
  const { trip } = await searchParams;
  const user = await requirePageUser();
  const [bookings, todos, dayNotes, dayReminders] = await Promise.all([
    getBookingsForUser(user.id, trip ?? null),
    getTodosForUser(user.id, trip ?? null),
    getDayNotesForUser(user.id, trip ?? null),
    getDayRemindersForUser(user.id, trip ?? null),
  ]);
  return (
    <Calendar
      key={trip ?? "all"}
      initialBookings={bookings}
      initialTodos={todos}
      initialDayNotes={dayNotes}
      initialDayReminders={dayReminders}
    />
  );
}
