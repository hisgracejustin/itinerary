import { and, asc, count, desc, eq, getTableColumns, inArray, isNotNull } from "drizzle-orm";
import { db, tables } from "@/db";
import { isAdmin } from "./authz";
import { personLabel } from "./audit";
import type { AuditEntityType, AuditLog } from "@/db/schema";

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
const optionSetCols = getTableColumns(tables.optionSets);
const optionCols = getTableColumns(tables.options);

/** Load booking_splits for a set of booking ids, grouped `booking_id → rows[]`. */
async function bookingSplitsByBooking(bookingIds: string[]) {
  const byBooking = new Map<
    string,
    {
      user_id: string;
      weight: number;
      extra_amount: number;
      paid_amount: number;
      base_amount: number | null;
    }[]
  >();
  if (bookingIds.length === 0) return byBooking;
  const rows = await db
    .select({
      booking_id: tables.bookingSplits.booking_id,
      user_id: tables.bookingSplits.user_id,
      weight: tables.bookingSplits.weight,
      extra_amount: tables.bookingSplits.extra_amount,
      paid_amount: tables.bookingSplits.paid_amount,
      base_amount: tables.bookingSplits.base_amount,
    })
    .from(tables.bookingSplits)
    .where(inArray(tables.bookingSplits.booking_id, bookingIds));
  for (const r of rows) {
    const list = byBooking.get(r.booking_id) ?? [];
    list.push({
      user_id: r.user_id,
      weight: r.weight,
      extra_amount: r.extra_amount,
      paid_amount: r.paid_amount,
      base_amount: r.base_amount,
    });
    byBooking.set(r.booking_id, list);
  }
  return byBooking;
}

/**
 * How many files each booking carries, grouped `booking_id → count`.
 *
 * A COUNT, not the rows: attachment bytes live in a bytea column on the same
 * table (see the storage note in schema.ts), so selecting metadata here would
 * still make the planner walk rows that a glance surface never renders. The
 * agenda only needs to know whether a paperclip belongs on the card.
 */
async function attachmentCountsByBooking(bookingIds: string[]) {
  const byBooking = new Map<string, number>();
  if (bookingIds.length === 0) return byBooking;
  const rows = await db
    .select({
      booking_id: tables.bookingAttachments.booking_id,
      n: count(),
    })
    .from(tables.bookingAttachments)
    .where(inArray(tables.bookingAttachments.booking_id, bookingIds))
    .groupBy(tables.bookingAttachments.booking_id);
  for (const r of rows) byBooking.set(r.booking_id, Number(r.n));
  return byBooking;
}

/** Load expense_splits for a set of expense ids, grouped `expense_id → rows[]`. */
async function expenseSplitsByExpense(expenseIds: string[]) {
  const byExpense = new Map<
    string,
    {
      user_id: string;
      weight: number;
      extra_amount: number;
      paid_amount: number;
      base_amount: number | null;
    }[]
  >();
  if (expenseIds.length === 0) return byExpense;
  const rows = await db
    .select({
      expense_id: tables.expenseSplits.expense_id,
      user_id: tables.expenseSplits.user_id,
      weight: tables.expenseSplits.weight,
      extra_amount: tables.expenseSplits.extra_amount,
      paid_amount: tables.expenseSplits.paid_amount,
      base_amount: tables.expenseSplits.base_amount,
    })
    .from(tables.expenseSplits)
    .where(inArray(tables.expenseSplits.expense_id, expenseIds));
  for (const r of rows) {
    const list = byExpense.get(r.expense_id) ?? [];
    list.push({
      user_id: r.user_id,
      weight: r.weight,
      extra_amount: r.extra_amount,
      paid_amount: r.paid_amount,
      base_amount: r.base_amount,
    });
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
  const ids2 = rows.map((b) => b.id);
  const [byBooking, attachmentCounts] = await Promise.all([
    bookingSplitsByBooking(ids2),
    attachmentCountsByBooking(ids2),
  ]);
  return rows.map((b) => ({
    ...b,
    splits: byBooking.get(b.id) ?? [],
    attachment_count: attachmentCounts.get(b.id) ?? 0,
  }));
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
      password_hash: tables.users.password_hash,
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
    const members = (byTrip.get(trip.id) ?? []).map(({ trip_id: _t, password_hash, ...m }) => ({
      ...m,
      has_account: withAccount.has(m.id),
      has_pin: !!password_hash,
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
 * ADMIN ONLY — every account on the instance, whatever trips it's on (including
 * none). The Settings People card is otherwise the union of the viewer's own
 * trips, which hides anyone who signed in but was never added to a trip. The
 * caller MUST gate this on `isAdmin`: it returns emails and account state for
 * people the viewer shares nothing with.
 *
 * Each row carries the same person-level fields as a trip member plus the names
 * of every trip they belong to (`trips`), so the UI can flag the strays.
 */
export async function getAllPeopleForAdmin() {
  const users = await db
    .select({
      id: tables.users.id,
      name: tables.users.name,
      email: tables.users.email,
      image: tables.users.image,
      password_hash: tables.users.password_hash,
    })
    .from(tables.users)
    .orderBy(asc(tables.users.name), asc(tables.users.email));
  if (users.length === 0) return [];

  const [memberships, accountRows] = await Promise.all([
    db
      .select({ user_id: tables.tripMembers.user_id, trip_name: tables.trips.name })
      .from(tables.tripMembers)
      .innerJoin(tables.trips, eq(tables.trips.id, tables.tripMembers.trip_id))
      .orderBy(asc(tables.trips.start_date)),
    db.select({ userId: tables.authAccounts.userId }).from(tables.authAccounts),
  ]);

  const tripsByUser = new Map<string, string[]>();
  for (const m of memberships) {
    const list = tripsByUser.get(m.user_id) ?? [];
    list.push(m.trip_name);
    tripsByUser.set(m.user_id, list);
  }
  const withAccount = new Set(accountRows.map((a) => a.userId));

  return users.map(({ password_hash, ...u }) => ({
    ...u,
    has_account: withAccount.has(u.id),
    has_pin: !!password_hash,
    trips: tripsByUser.get(u.id) ?? [],
  }));
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
 * Attachment METADATA (never `content`) for every booking the user can see,
 * carrying its booking's trip and dates. The offline day sheet embeds this so a
 * booking's files are listed without a client round trip, and the sync effect
 * knows which files are still worth pre-caching.
 */
export function getAttachmentsForUser(userId: string, tripId?: TripFilter) {
  const base = db
    .select({
      id: tables.bookingAttachments.id,
      booking_id: tables.bookingAttachments.booking_id,
      filename: tables.bookingAttachments.filename,
      mime_type: tables.bookingAttachments.mime_type,
      size_bytes: tables.bookingAttachments.size_bytes,
      trip_id: tables.bookings.trip_id,
      booking_start: tables.bookings.start_date,
      booking_end: tables.bookings.end_date,
    })
    .from(tables.bookingAttachments)
    .innerJoin(tables.bookings, eq(tables.bookings.id, tables.bookingAttachments.booking_id))
    .innerJoin(
      tables.tripMembers,
      and(
        eq(tables.tripMembers.trip_id, tables.bookings.trip_id),
        eq(tables.tripMembers.user_id, userId),
      ),
    );
  const ids = toTripIds(tripId);
  if (ids) {
    return base
      .where(inArray(tables.bookings.trip_id, ids))
      .orderBy(asc(tables.bookingAttachments.created_at));
  }
  return base.orderBy(asc(tables.bookingAttachments.created_at));
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

/* ---------------------------------- audit ---------------------------------- */

/**
 * Reading the audit trail is a stricter permission than reading the trip: an
 * editor can change a booking but must not be able to audit their fellow
 * members, so it's admin, or an OWNER of the trip the row itself names.
 *
 * The check runs against the audit row's own `trip_id` and never joins to the
 * entity — the whole reason to read the log is often that the entity is gone.
 */
async function auditReadableTrips(userId: string, tripIds: string[]) {
  if (tripIds.length === 0) return new Set<string>();
  const [me] = await db
    .select({ email: tables.users.email })
    .from(tables.users)
    .where(eq(tables.users.id, userId))
    .limit(1);
  if (me && isAdmin(me)) return new Set(tripIds);
  const rows = await db
    .select({ trip_id: tables.tripMembers.trip_id })
    .from(tables.tripMembers)
    .where(
      and(
        eq(tables.tripMembers.user_id, userId),
        eq(tables.tripMembers.role, "owner"),
        inArray(tables.tripMembers.trip_id, tripIds),
      ),
    );
  return new Set(rows.map((r) => r.trip_id));
}

/** A person on an audit row: the id it stored and the best label available now. */
export type AuditPerson = { id: string | null; label: string; present: boolean };

export type AuditEntry = {
  id: string;
  trip_id: string;
  entity_type: AuditEntityType;
  entity_id: string;
  entity_label: string;
  action: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  old_people: AuditPerson[];
  new_people: AuditPerson[];
  by: AuditPerson;
  changed_at: Date;
};

/**
 * Attach today's identities to stored rows. Every person is looked up by id and
 * falls back to the label frozen at write time when the account is gone — and
 * where two live people share a display name, both get their email appended, so
 * a payer change between two Justins doesn't read "Justin → Justin".
 */
async function resolveAuditRows(rows: AuditLog[]): Promise<AuditEntry[]> {
  const ids = new Set<string>();
  for (const r of rows) {
    if (r.changed_by) ids.add(r.changed_by);
    for (const id of r.old_refs ?? []) ids.add(id);
    for (const id of r.new_refs ?? []) ids.add(id);
  }
  const users = ids.size
    ? await db
        .select({ id: tables.users.id, name: tables.users.name, email: tables.users.email })
        .from(tables.users)
        .where(inArray(tables.users.id, [...ids]))
    : [];
  const seen = new Map<string, number>();
  for (const u of users) {
    const base = personLabel(u);
    seen.set(base, (seen.get(base) ?? 0) + 1);
  }
  const live = new Map<string, string>();
  for (const u of users) {
    const base = personLabel(u);
    live.set(u.id, (seen.get(base) ?? 0) > 1 && u.email ? `${base} (${u.email})` : base);
  }

  // The account is gone, so the name frozen at write time is all there is. It's
  // marked only when someone still here answers to it — otherwise "Justin left
  // and Justin joined" reads as one person changing their mind.
  const labelFor = (id: string, stored: string) =>
    live.get(id) ?? (seen.has(stored) ? `${stored} (removed)` : stored);

  const person = (id: string, fallback: string): AuditPerson => ({
    id,
    label: labelFor(id, fallback),
    present: live.has(id),
  });

  // Person-valued fields are stored as one " · " segment per ref, in ref order,
  // each starting with that person's name and ending in whatever detail belongs
  // to them ("Kate ×1 (+HK$50)"). So re-labelling is replacing each segment's
  // leading name — which is what tells two people called Justin apart in a split
  // line as well as in a payer change. Anything that doesn't line up segment for
  // segment keeps the stored text, which is always readable on its own.
  const relabel = (value: string | null, refs: string[] | null) => {
    if (!value || !refs?.length) return value;
    const parts = value.split(" · ");
    if (parts.length !== refs.length) return value;
    return parts
      .map((part, i) => {
        const detail = part.indexOf(" ×");
        const stored = detail === -1 ? part : part.slice(0, detail);
        const label = labelFor(refs[i], stored);
        return detail === -1 ? label : label + part.slice(detail);
      })
      .join(" · ");
  };

  return rows.map((r) => {
    const refPeople = (refs: string[] | null, stored: string | null) =>
      (refs ?? []).map((id) => person(id, stored ?? "Someone"));
    return {
      id: r.id,
      trip_id: r.trip_id,
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      entity_label: r.entity_label,
      action: r.action,
      field: r.field,
      old_value: relabel(r.old_value, r.old_refs),
      new_value: relabel(r.new_value, r.new_refs),
      old_people: refPeople(r.old_refs, r.old_value),
      new_people: refPeople(r.new_refs, r.new_value),
      by: r.changed_by
        ? person(r.changed_by, r.changed_by_label)
        : { id: null, label: r.changed_by_label, present: false },
      changed_at: r.changed_at,
    };
  });
}

/** History of one booking/expense/settlement/party, newest first. */
export async function getAuditForEntity(
  userId: string,
  entityType: AuditEntityType,
  entityId: string,
) {
  const rows = await db
    .select()
    .from(tables.auditLog)
    .where(
      and(eq(tables.auditLog.entity_type, entityType), eq(tables.auditLog.entity_id, entityId)),
    )
    .orderBy(desc(tables.auditLog.changed_at));
  if (rows.length === 0) return [];
  const allowed = await auditReadableTrips(userId, [...new Set(rows.map((r) => r.trip_id))]);
  return resolveAuditRows(rows.filter((r) => allowed.has(r.trip_id)));
}

/**
 * Option sets (decisions) with nested options and image metadata for every
 * accessible trip (or a trip filter). Image bytes are never loaded here — the
 * UI fetches `/api/option-images/[id]` when rendering a photo.
 */
export async function getOptionSetsForUser(userId: string, tripId?: TripFilter) {
  const ids = toTripIds(tripId);
  const setBase = db
    .select(optionSetCols)
    .from(tables.optionSets)
    .innerJoin(
      tables.tripMembers,
      and(
        eq(tables.tripMembers.trip_id, tables.optionSets.trip_id),
        eq(tables.tripMembers.user_id, userId),
      ),
    );
  const sets = ids
    ? await setBase
        .where(inArray(tables.optionSets.trip_id, ids))
        .orderBy(desc(tables.optionSets.created_at))
    : await setBase.orderBy(desc(tables.optionSets.created_at));

  if (sets.length === 0) return [];

  const setIds = sets.map((s) => s.id);
  const optionRows = await db
    .select(optionCols)
    .from(tables.options)
    .where(inArray(tables.options.option_set_id, setIds))
    .orderBy(asc(tables.options.sort_order), asc(tables.options.created_at));

  const optionIds = optionRows.map((o) => o.id);
  const imageRows =
    optionIds.length === 0
      ? []
      : await db
          .select({
            id: tables.optionImages.id,
            option_id: tables.optionImages.option_id,
            filename: tables.optionImages.filename,
            mime_type: tables.optionImages.mime_type,
            size_bytes: tables.optionImages.size_bytes,
            sort_order: tables.optionImages.sort_order,
            created_at: tables.optionImages.created_at,
          })
          .from(tables.optionImages)
          .where(inArray(tables.optionImages.option_id, optionIds))
          .orderBy(asc(tables.optionImages.sort_order), asc(tables.optionImages.created_at));

  const imagesByOption = new Map<string, typeof imageRows>();
  for (const img of imageRows) {
    const list = imagesByOption.get(img.option_id) ?? [];
    list.push(img);
    imagesByOption.set(img.option_id, list);
  }

  const optionsBySet = new Map<string, (typeof optionRows[number] & { images: typeof imageRows })[]>();
  for (const opt of optionRows) {
    const list = optionsBySet.get(opt.option_set_id) ?? [];
    list.push({ ...opt, images: imagesByOption.get(opt.id) ?? [] });
    optionsBySet.set(opt.option_set_id, list);
  }

  return sets.map((set) => ({
    ...set,
    options: optionsBySet.get(set.id) ?? [],
  }));
}

/** Most recent entries for a whole trip, deletions included. */
const TRIP_AUDIT_LIMIT = 100;

export async function getAuditForTrip(userId: string, tripId: string) {
  const allowed = await auditReadableTrips(userId, [tripId]);
  if (!allowed.has(tripId)) return { entries: [], truncated: false };
  // One over the cap, so "there is more history than this" is known rather than
  // guessed — the feed says so instead of silently ending.
  const rows = await db
    .select()
    .from(tables.auditLog)
    .where(eq(tables.auditLog.trip_id, tripId))
    .orderBy(desc(tables.auditLog.changed_at))
    .limit(TRIP_AUDIT_LIMIT + 1);
  return {
    entries: await resolveAuditRows(rows.slice(0, TRIP_AUDIT_LIMIT)),
    truncated: rows.length > TRIP_AUDIT_LIMIT,
  };
}
