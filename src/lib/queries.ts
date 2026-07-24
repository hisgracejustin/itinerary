import { and, asc, eq, getTableColumns, inArray, isNotNull } from "drizzle-orm";
import { db, tables } from "@/db";

/**
 * Read queries, userId-scoped. Authorization is folded INTO the data query via a
 * membership JOIN, so each read is a single DB round trip (the old code did a
 * separate `requireTripAccess` / `accessibleTripIds` SELECT first). A row comes
 * back only if the user is a member of its trip — a non-member simply sees an
 * empty result, which is the correct read-side behavior.
 *
 * These are pure (no `auth()` inside) so both RSC pages and Server Actions can
 * share them: the caller passes the already-resolved `userId`.
 */

const bookingCols = getTableColumns(tables.bookings);
const todoCols = getTableColumns(tables.todos);
const dayNoteCols = getTableColumns(tables.dayNotes);
const expenseCols = getTableColumns(tables.expenses);
const settlementCols = getTableColumns(tables.settlements);

/** Load booking_splits for a set of booking ids, grouped `booking_id → rows[]`. */
async function bookingSplitsByBooking(bookingIds: string[]) {
  const byBooking = new Map<string, { user_id: string; weight: number }[]>();
  if (bookingIds.length === 0) return byBooking;
  const rows = await db
    .select({
      booking_id: tables.bookingSplits.booking_id,
      user_id: tables.bookingSplits.user_id,
      weight: tables.bookingSplits.weight,
    })
    .from(tables.bookingSplits)
    .where(inArray(tables.bookingSplits.booking_id, bookingIds));
  for (const r of rows) {
    const list = byBooking.get(r.booking_id) ?? [];
    list.push({ user_id: r.user_id, weight: r.weight });
    byBooking.set(r.booking_id, list);
  }
  return byBooking;
}

/** Load expense_splits for a set of expense ids, grouped `expense_id → rows[]`. */
async function expenseSplitsByExpense(expenseIds: string[]) {
  const byExpense = new Map<string, { user_id: string; weight: number }[]>();
  if (expenseIds.length === 0) return byExpense;
  const rows = await db
    .select({
      expense_id: tables.expenseSplits.expense_id,
      user_id: tables.expenseSplits.user_id,
      weight: tables.expenseSplits.weight,
    })
    .from(tables.expenseSplits)
    .where(inArray(tables.expenseSplits.expense_id, expenseIds));
  for (const r of rows) {
    const list = byExpense.get(r.expense_id) ?? [];
    list.push({ user_id: r.user_id, weight: r.weight });
    byExpense.set(r.expense_id, list);
  }
  return byExpense;
}

/**
 * Normalize the trip filter accepted across the read queries. `null`/`undefined`
 * (and an empty selection) mean "every accessible trip"; one or more ids narrow
 * to those trips via `inArray`. A single string is still accepted for callers
 * that haven't moved to the array form.
 */
type TripFilter = string | string[] | null | undefined;
function toTripIds(tripId: TripFilter): string[] | null {
  if (tripId == null) return null;
  const arr = (Array.isArray(tripId) ? tripId : [tripId]).filter(Boolean);
  return arr.length ? arr : null;
}

/** Trips the user is a member of (the sidebar list; also carries each trip's dates). */
export function getTripsForUser(userId: string) {
  return db
    .select({
      id: tables.trips.id,
      name: tables.trips.name,
      start_date: tables.trips.start_date,
      end_date: tables.trips.end_date,
    })
    .from(tables.trips)
    .innerJoin(
      tables.tripMembers,
      and(eq(tables.tripMembers.trip_id, tables.trips.id), eq(tables.tripMembers.user_id, userId)),
    )
    .orderBy(asc(tables.trips.start_date));
}

/** A single trip the user can access, or null. */
export async function getTripForUser(userId: string, tripId: string) {
  const [trip] = await db
    .select(getTableColumns(tables.trips))
    .from(tables.trips)
    .innerJoin(
      tables.tripMembers,
      and(eq(tables.tripMembers.trip_id, tables.trips.id), eq(tables.tripMembers.user_id, userId)),
    )
    .where(eq(tables.trips.id, tripId))
    .limit(1);
  return trip ?? null;
}

/**
 * Bookings for the selected trip(s), or across every accessible trip when none
 * given. Each row carries its `splits` ([{user_id, weight}]) so the Costs page
 * and settle math can divide the cost; `paid_by` rides on the row already.
 */
export async function getBookingsForUser(userId: string, tripId?: TripFilter) {
  const base = db
    .select(bookingCols)
    .from(tables.bookings)
    .innerJoin(
      tables.tripMembers,
      and(
        eq(tables.tripMembers.trip_id, tables.bookings.trip_id),
        eq(tables.tripMembers.user_id, userId),
      ),
    );
  const ids = toTripIds(tripId);
  const rows = ids
    ? await base.where(inArray(tables.bookings.trip_id, ids)).orderBy(asc(tables.bookings.start_date))
    : await base.orderBy(asc(tables.bookings.start_date));
  const byBooking = await bookingSplitsByBooking(rows.map((b) => b.id));
  return rows.map((b) => ({ ...b, splits: byBooking.get(b.id) ?? [] }));
}

/**
 * Ad-hoc expenses for the selected trip(s), or across every accessible trip when
 * none given — mirrors `getBookingsForUser`. Each row carries its `splits`
 * ([{user_id, weight}]); `paid_by` rides on the row already. The membership INNER
 * JOIN is the authorization (a non-member sees nothing).
 */
export async function getExpensesForUser(userId: string, tripId?: TripFilter) {
  const base = db
    .select(expenseCols)
    .from(tables.expenses)
    .innerJoin(
      tables.tripMembers,
      and(
        eq(tables.tripMembers.trip_id, tables.expenses.trip_id),
        eq(tables.tripMembers.user_id, userId),
      ),
    );
  const ids = toTripIds(tripId);
  const rows = ids
    ? await base.where(inArray(tables.expenses.trip_id, ids)).orderBy(asc(tables.expenses.created_at))
    : await base.orderBy(asc(tables.expenses.created_at));
  const byExpense = await expenseSplitsByExpense(rows.map((e) => e.id));
  return rows.map((e) => ({ ...e, splits: byExpense.get(e.id) ?? [] }));
}

// Each todo carries its assignee's display fields (flattened, snake_case to
// match the rest of the row shape) so the list renders avatars/names without a
// second query or a client-side user lookup. Null across the board = unassigned.
const assigneeCols = {
  assignee_name: tables.users.name,
  assignee_email: tables.users.email,
  assignee_image: tables.users.image,
};

/**
 * Todos for one trip, or every accessible trip when `tripId` is null.
 *
 * trip_id is NOT NULL, so the membership INNER JOIN is the whole authorization
 * story — there is no unowned row for a query to accidentally expose.
 */
export function getTodosForUser(userId: string, tripId?: TripFilter) {
  const base = db
    .select({ ...todoCols, ...assigneeCols })
    .from(tables.todos)
    .innerJoin(
      tables.tripMembers,
      and(
        eq(tables.tripMembers.trip_id, tables.todos.trip_id),
        eq(tables.tripMembers.user_id, userId),
      ),
    )
    .leftJoin(tables.users, eq(tables.users.id, tables.todos.assignee_id));
  const ids = toTripIds(tripId);
  if (ids) {
    return base
      .where(inArray(tables.todos.trip_id, ids))
      .orderBy(asc(tables.todos.position), asc(tables.todos.created_at));
  }
  return base.orderBy(asc(tables.todos.position), asc(tables.todos.created_at));
}

/**
 * Every trip the user belongs to, each with its full member list and the user's
 * own role on it — the Settings screen's data. One membership query plus one
 * member/user join, stitched in memory rather than N queries per trip.
 */
export async function getTripsWithMembers(userId: string) {
  const trips = await getTripsForUser(userId);
  if (trips.length === 0) return [];

  const tripIds = trips.map((t) => t.id);

  const rows = await db
    .select({
      trip_id: tables.tripMembers.trip_id,
      role: tables.tripMembers.role,
      party_id: tables.tripMembers.party_id,
      id: tables.users.id,
      name: tables.users.name,
      email: tables.users.email,
      image: tables.users.image,
    })
    .from(tables.tripMembers)
    .innerJoin(tables.users, eq(tables.users.id, tables.tripMembers.user_id))
    .where(inArray(tables.tripMembers.trip_id, tripIds))
    .orderBy(asc(tables.users.name), asc(tables.users.email));

  // Which of these members have ever signed in (≥1 row in the accounts table) —
  // so the Settings UI can phrase the email-change confirm. One batched select.
  const memberIds = [...new Set(rows.map((r) => r.id))];
  const accountRows = memberIds.length
    ? await db
        .select({ userId: tables.authAccounts.userId })
        .from(tables.authAccounts)
        .where(inArray(tables.authAccounts.userId, memberIds))
    : [];
  const withAccount = new Set(accountRows.map((a) => a.userId));

  const byTrip = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byTrip.get(r.trip_id) ?? [];
    list.push(r);
    byTrip.set(r.trip_id, list);
  }

  // Each trip's settlement units (couples/groups) — display names for the roster.
  const partyRows = await db
    .select({
      id: tables.tripParties.id,
      name: tables.tripParties.name,
      trip_id: tables.tripParties.trip_id,
    })
    .from(tables.tripParties)
    .where(inArray(tables.tripParties.trip_id, tripIds))
    .orderBy(asc(tables.tripParties.created_at));

  const partiesByTrip = new Map<string, { id: string; name: string }[]>();
  for (const p of partyRows) {
    const list = partiesByTrip.get(p.trip_id) ?? [];
    list.push({ id: p.id, name: p.name });
    partiesByTrip.set(p.trip_id, list);
  }

  return trips.map((trip) => {
    const members = (byTrip.get(trip.id) ?? []).map(({ trip_id: _t, ...m }) => ({
      ...m,
      has_account: withAccount.has(m.id),
    }));
    return {
      ...trip,
      members,
      parties: partiesByTrip.get(trip.id) ?? [],
      myRole: members.find((m) => m.id === userId)?.role ?? null,
    };
  });
}

/**
 * People a to-do can be assigned to, mirroring `requireAssignable`:
 *  - a specific trip → its members.
 *  - no trip selected → everyone the user shares any trip with (themselves
 *    included), deduped, since tripless to-dos aren't scoped to one trip.
 */
export async function getAssignableUsers(userId: string, tripId?: TripFilter) {
  const ids = toTripIds(tripId);
  if (ids) {
    // Members of the selected trip(s), deduped. Role is only meaningful for a
    // single trip; across several a user may hold different roles, so it's
    // dropped — the assignment UI only needs identity, not role.
    return db
      .selectDistinct({
        id: tables.users.id,
        name: tables.users.name,
        email: tables.users.email,
        image: tables.users.image,
      })
      .from(tables.tripMembers)
      .innerJoin(tables.users, eq(tables.users.id, tables.tripMembers.user_id))
      .where(inArray(tables.tripMembers.trip_id, ids))
      .orderBy(asc(tables.users.name), asc(tables.users.email));
  }

  const mine = db
    .select({ trip_id: tables.tripMembers.trip_id })
    .from(tables.tripMembers)
    .where(eq(tables.tripMembers.user_id, userId));

  const rows = await db
    .selectDistinct({
      id: tables.users.id,
      name: tables.users.name,
      email: tables.users.email,
      image: tables.users.image,
    })
    .from(tables.tripMembers)
    .innerJoin(tables.users, eq(tables.users.id, tables.tripMembers.user_id))
    .where(inArray(tables.tripMembers.trip_id, mine))
    .orderBy(asc(tables.users.name), asc(tables.users.email));

  // The user always belongs in the list even with no trips yet.
  if (rows.some((r) => r.id === userId)) return rows;
  const [self] = await db
    .select({
      id: tables.users.id,
      name: tables.users.name,
      email: tables.users.email,
      image: tables.users.image,
    })
    .from(tables.users)
    .where(eq(tables.users.id, userId))
    .limit(1);
  return self ? [self, ...rows] : rows;
}

/** Day notes for the selected trip(s), or every accessible trip when none given. */
export function getDayNotesForUser(userId: string, tripId?: TripFilter) {
  const base = db
    .select(dayNoteCols)
    .from(tables.dayNotes)
    .innerJoin(
      tables.tripMembers,
      and(
        eq(tables.tripMembers.trip_id, tables.dayNotes.trip_id),
        eq(tables.tripMembers.user_id, userId),
      ),
    );
  const ids = toTripIds(tripId);
  if (ids) {
    return base.where(inArray(tables.dayNotes.trip_id, ids)).orderBy(asc(tables.dayNotes.date));
  }
  return base.orderBy(asc(tables.dayNotes.date));
}

const dayReminderCols = getTableColumns(tables.dayReminders);

/** Per-day reminders, ordered by date then manual position, then insertion. */
export function getDayRemindersForUser(userId: string, tripId?: TripFilter) {
  const order = [
    asc(tables.dayReminders.date),
    asc(tables.dayReminders.position),
    asc(tables.dayReminders.created_at),
  ];
  const base = db
    .select(dayReminderCols)
    .from(tables.dayReminders)
    .innerJoin(
      tables.tripMembers,
      and(
        eq(tables.tripMembers.trip_id, tables.dayReminders.trip_id),
        eq(tables.tripMembers.user_id, userId),
      ),
    );
  const ids = toTripIds(tripId);
  if (ids) {
    return base.where(inArray(tables.dayReminders.trip_id, ids)).orderBy(...order);
  }
  return base.orderBy(...order);
}

/**
 * Everything the Settle page needs, for EVERY accessible trip. Like all pages,
 * Settle fetches the union and the screen filters by the client-side selection,
 * so multi-trip settling works from day one. Rows carry `trip_id`; members carry
 * `party_id`; only cost-bearing bookings are included, each with `splits`
 * attached; expenses carry their `splits` too. The membership INNER JOINs on the
 * cost data are the authorization (a non-member sees nothing).
 */
export async function getSettleData(userId: string) {
  const trips = await getTripsForUser(userId);
  const tripIds = trips.map((t) => t.id);
  if (tripIds.length === 0) {
    return { members: [], parties: [], bookings: [], expenses: [], settlements: [] };
  }

  const members = await db
    .select({
      trip_id: tables.tripMembers.trip_id,
      party_id: tables.tripMembers.party_id,
      role: tables.tripMembers.role,
      id: tables.users.id,
      name: tables.users.name,
      email: tables.users.email,
      image: tables.users.image,
    })
    .from(tables.tripMembers)
    .innerJoin(tables.users, eq(tables.users.id, tables.tripMembers.user_id))
    .where(inArray(tables.tripMembers.trip_id, tripIds))
    .orderBy(asc(tables.users.name), asc(tables.users.email));

  const parties = await db
    .select({
      id: tables.tripParties.id,
      name: tables.tripParties.name,
      trip_id: tables.tripParties.trip_id,
    })
    .from(tables.tripParties)
    .where(inArray(tables.tripParties.trip_id, tripIds));

  // Cost-bearing bookings only; the membership join authorizes them.
  const bookingRows = await db
    .select(bookingCols)
    .from(tables.bookings)
    .innerJoin(
      tables.tripMembers,
      and(
        eq(tables.tripMembers.trip_id, tables.bookings.trip_id),
        eq(tables.tripMembers.user_id, userId),
      ),
    )
    .where(and(isNotNull(tables.bookings.cost_amount), isNotNull(tables.bookings.cost_currency)))
    .orderBy(asc(tables.bookings.start_date));
  const bookingSplits = await bookingSplitsByBooking(bookingRows.map((b) => b.id));
  const bookings = bookingRows.map((b) => ({ ...b, splits: bookingSplits.get(b.id) ?? [] }));

  const expenseRows = await db
    .select(expenseCols)
    .from(tables.expenses)
    .innerJoin(
      tables.tripMembers,
      and(
        eq(tables.tripMembers.trip_id, tables.expenses.trip_id),
        eq(tables.tripMembers.user_id, userId),
      ),
    )
    .orderBy(asc(tables.expenses.created_at));
  const splitsByExpense = await expenseSplitsByExpense(expenseRows.map((e) => e.id));
  const expenses = expenseRows.map((e) => ({ ...e, splits: splitsByExpense.get(e.id) ?? [] }));

  const settlements = await db
    .select(settlementCols)
    .from(tables.settlements)
    .innerJoin(
      tables.tripMembers,
      and(
        eq(tables.tripMembers.trip_id, tables.settlements.trip_id),
        eq(tables.tripMembers.user_id, userId),
      ),
    )
    .orderBy(asc(tables.settlements.created_at));

  return { members, parties, bookings, expenses, settlements };
}
