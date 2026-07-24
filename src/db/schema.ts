import {
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import type { AdapterAccountType } from "next-auth/adapters";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// pg-core has no built-in bytea. Both drivers hand back the raw bytes on read
// (node-postgres → Buffer, PGlite → Uint8Array); we always write a Buffer.
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/* ------------------------------- auth (Auth.js) ------------------------------- */
// Copied from the sibling `nav` app. `users.id` is a text column: for migrated
// accounts we preserve the original Supabase `auth.users` UUID string as this id,
// so every existing `trip_members.user_id` stays valid without remapping.

export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text("name"),
  email: text("email").unique().notNull(),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  image: text("image"),
  // Email+PIN login for members without a Google account. Set by a trip owner,
  // verified by the "pin" Credentials provider. `salt:hash` scrypt format.
  password_hash: text("password_hash"),
  failed_pin_attempts: integer("failed_pin_attempts").notNull().default(0),
  pin_locked_until: timestamp("pin_locked_until", { withTimezone: true }),
});

export const authAccounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

/* ---------------------------------- app ---------------------------------- */
// JS property names are intentionally snake_case to match the existing UI's
// field access (booking.start_date, trip.start_date, cost_amount, …) and the
// DB column names, so the ported React components need no field renames.

export const tripRole = pgEnum("trip_role", ["owner", "editor", "viewer"]);
export const bookingType = pgEnum("booking_type", [
  "flight",
  "train",
  "bus",
  "cruise",
  "hotel",
  "activity",
  "rental",
]);
export const bookingSource = pgEnum("booking_source", ["manual", "parsed"]);
// Board column a to-do lives in. `done` replaces the old `completed` boolean
// (completed=true → done); `todo`/`in_progress` are the two open columns.
export const todoStatus = pgEnum("todo_status", ["todo", "in_progress", "done"]);

export const trips = pgTable("trips", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  start_date: text("start_date").notNull(),
  end_date: text("end_date").notNull(),
  created_at: createdAt(),
});

export const tripMembers = pgTable(
  "trip_members",
  {
    trip_id: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: tripRole("role").notNull().default("editor"),
    // Settlement unit this member belongs to (couple/group). At most one; null =
    // solo. Set-null on party delete so ungrouping is just deleting the party.
    party_id: uuid("party_id").references(() => tripParties.id, { onDelete: "set null" }),
    created_at: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.trip_id, t.user_id] }),
    index("idx_trip_members_user").on(t.user_id),
  ],
);

export const bookings = pgTable(
  "bookings",
  {
    id: text("id").primaryKey(),
    trip_id: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    type: bookingType("type").notNull(),
    title: text("title").notNull(),
    start_date: text("start_date").notNull(),
    end_date: text("end_date"),
    confirmation_number: text("confirmation_number"),
    provider: text("provider"),
    details: jsonb("details").$type<Record<string, unknown>>(),
    cost_amount: numeric("cost_amount", { mode: "number" }),
    cost_currency: text("cost_currency"),
    cost_share: numeric("cost_share", { mode: "number" }).default(1),
    // Who fronted this cost. Null = unallocated (a cost with no payer is excluded
    // from settlement balances and surfaced as "needs attention"). Set-null on
    // user delete so removing a member leaves the booking behind, just unpaid.
    paid_by: text("paid_by").references(() => users.id, { onDelete: "set null" }),
    // The EXACT currency + rate this item was charged at (e.g. a USD fare billed
    // to an HKD card at a known rate). Both null = settle in the native currency.
    // When set, settlement re-denominates the whole item at this rate — exact,
    // NOT approximate FX (see src/lib/split.js). charged_currency differs from
    // the item's own cost_currency.
    charged_currency: text("charged_currency"),
    charged_rate: numeric("charged_rate", { mode: "number" }),
    source: bookingSource("source").default("manual"),
    source_file: text("source_file"),
    raw_text: text("raw_text"),
    created_at: createdAt(),
  },
  (t) => [
    index("idx_bookings_trip_id").on(t.trip_id),
    index("idx_bookings_start_date").on(t.start_date),
    index("idx_bookings_type").on(t.type),
  ],
);

export const bookingAttachments = pgTable(
  "booking_attachments",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    booking_id: text("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mime_type: text("mime_type").notNull(),
    size_bytes: integer("size_bytes").notNull(),
    content: bytea("content").notNull(),
    uploaded_by: text("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    created_at: createdAt(),
  },
  (t) => [index("idx_booking_attachments_booking_id").on(t.booking_id)],
);

export const todos = pgTable(
  "todos",
  {
    id: text("id").primaryKey(),
    trip_id: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    due_date: text("due_date"),
    // Which board column this to-do sits in. Replaces the old `completed`
    // boolean: `done` is the former completed=true. Defaults to the "To do"
    // column so freshly-created items start at the top of the board.
    status: todoStatus("status").notNull().default("todo"),
    // Who owns this to-do. Null = unassigned (surfaced explicitly in the UI so
    // nothing silently falls through the cracks). `set null` on user delete so
    // removing a member leaves their to-dos behind as unassigned rather than
    // deleting work items.
    assignee_id: text("assignee_id").references(() => users.id, { onDelete: "set null" }),
    // Manual sort order. Lower sorts first; new todos append to the end. The
    // list is ordered by this rather than due_date so users can drag rows into
    // whatever order they want.
    position: integer("position").notNull().default(0),
    created_at: createdAt(),
  },
  (t) => [
    index("idx_todos_trip_id").on(t.trip_id),
    index("idx_todos_due_date").on(t.due_date),
    index("idx_todos_position").on(t.position),
    index("idx_todos_assignee_id").on(t.assignee_id),
    index("idx_todos_status").on(t.status),
  ],
);

export const dayNotes = pgTable(
  "day_notes",
  {
    id: text("id").primaryKey(),
    date: text("date").notNull(),
    trip_id: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    created_at: createdAt(),
  },
  (t) => [
    index("idx_day_notes_date").on(t.date),
    index("idx_day_notes_trip_id").on(t.trip_id),
  ],
);

// Free-form per-day notes/reminders — a list of items per (date, trip), distinct
// from the single day_notes.title label. Each carries text and an optional time
// (e.g. "be in Oakhurst by 5pm"). Many per day, unlike day_notes.
export const dayReminders = pgTable(
  "day_reminders",
  {
    id: text("id").primaryKey(),
    date: text("date").notNull(),
    trip_id: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    time: text("time"), // optional "HH:MM" (24h); null = untimed
    // Manual sort order within a (date, trip). Lower sorts first; new items
    // append to the end. Overrides time-based ordering once the user drags.
    position: integer("position").notNull().default(0),
    created_at: createdAt(),
  },
  (t) => [
    index("idx_day_reminders_date").on(t.date),
    index("idx_day_reminders_trip_id").on(t.trip_id),
  ],
);

// Settlement units — a couple or group that settles as one. Members point at a
// party via trip_members.party_id; parties never appear in split rows, they only
// aggregate at settlement/display time. Per-trip rows: the same real-world couple
// on two trips is two party rows, merged into one unit by member-id set at math
// time (see src/lib/split.js).
export const tripParties = pgTable(
  "trip_parties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trip_id: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    created_at: createdAt(),
  },
  (t) => [index("idx_trip_parties_trip_id").on(t.trip_id)],
);

// Per-person split rows for a booking's cost. A person's share of the splittable
// amount = weight / Σweights over the booking's rows. No rows = unallocated.
export const bookingSplits = pgTable(
  "booking_splits",
  {
    booking_id: text("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    weight: numeric("weight", { mode: "number" }).notNull().default(1),
    // Itemized amount attributed to this person off the top (e.g. their baggage
    // on a shared flight). Their share = extra + weight/Σweights × (splittable −
    // Σextras). 0 for everyone reproduces the pure weight split byte-for-byte.
    extra_amount: numeric("extra_amount", { mode: "number" }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.booking_id, t.user_id] })],
);

// Ad-hoc shared costs (dinner, taxi…) that aren't bookings. Splittable amount is
// simply `amount`. paid_by null = unallocated, same treatment as a booking.
export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trip_id: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    amount: numeric("amount", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    paid_by: text("paid_by").references(() => users.id, { onDelete: "set null" }),
    date: text("date"), // optional "YYYY-MM-DD", matching trips' text dates
    // Exact charged currency + rate — mirrors bookings.charged_currency/rate.
    charged_currency: text("charged_currency"),
    charged_rate: numeric("charged_rate", { mode: "number" }),
    created_at: createdAt(),
  },
  (t) => [index("idx_expenses_trip_id").on(t.trip_id)],
);

// Per-person split rows for an expense — mirrors booking_splits.
export const expenseSplits = pgTable(
  "expense_splits",
  {
    expense_id: uuid("expense_id")
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    weight: numeric("weight", { mode: "number" }).notNull().default(1),
    // Itemized amount attributed to this person off the top — mirrors
    // booking_splits.extra_amount.
    extra_amount: numeric("extra_amount", { mode: "number" }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.expense_id, t.user_id] })],
);

// Recorded pay-backs, person-to-person (never party-to-party). Applied exactly
// in their recorded currency — never FX-converted. Kept as history even if a
// member is later removed from the trip.
export const settlements = pgTable(
  "settlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trip_id: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    from_user: text("from_user")
      .notNull()
      .references(() => users.id),
    to_user: text("to_user")
      .notNull()
      .references(() => users.id),
    amount: numeric("amount", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    note: text("note"),
    created_at: createdAt(),
  },
  (t) => [index("idx_settlements_trip_id").on(t.trip_id)],
);

// Rolling cache of live FX rates (Frankfurter/ECB), used ONLY to sharpen the
// approximate ~HKD conversions on the Costs/Settle pages — never settlement
// math. `rate_to_hkd` is our semantic "1 currency = Y HKD" (matching the static
// FX_RATES_TO_HKD table), NOT the Frankfurter base=HKD inverse; src/lib/fx.ts
// stores Y = 1/X. Refreshed lazily after the response when stale and pruned to a
// rolling ~30-day window; toHKD prefers the newest row, falling back to the
// static table when the cache is empty.
export const fxRates = pgTable(
  "fx_rates",
  {
    rate_date: text("rate_date").notNull(), // "YYYY-MM-DD" — the ECB publication date
    currency: text("currency").notNull(),
    rate_to_hkd: numeric("rate_to_hkd", { mode: "number" }).notNull(),
    fetched_at: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.rate_date, t.currency] })],
);

/* -------------------------------- relations -------------------------------- */

export const usersRelations = relations(users, ({ many }) => ({
  tripMembers: many(tripMembers),
}));

export const tripsRelations = relations(trips, ({ many }) => ({
  members: many(tripMembers),
  bookings: many(bookings),
  todos: many(todos),
  dayNotes: many(dayNotes),
  dayReminders: many(dayReminders),
  parties: many(tripParties),
  expenses: many(expenses),
  settlements: many(settlements),
}));

export const tripMembersRelations = relations(tripMembers, ({ one }) => ({
  trip: one(trips, { fields: [tripMembers.trip_id], references: [trips.id] }),
  user: one(users, { fields: [tripMembers.user_id], references: [users.id] }),
  party: one(tripParties, { fields: [tripMembers.party_id], references: [tripParties.id] }),
}));

export const bookingsRelations = relations(bookings, ({ one, many }) => ({
  trip: one(trips, { fields: [bookings.trip_id], references: [trips.id] }),
  attachments: many(bookingAttachments),
  splits: many(bookingSplits),
  payer: one(users, { fields: [bookings.paid_by], references: [users.id] }),
}));

export const tripPartiesRelations = relations(tripParties, ({ one, many }) => ({
  trip: one(trips, { fields: [tripParties.trip_id], references: [trips.id] }),
  members: many(tripMembers),
}));

export const bookingSplitsRelations = relations(bookingSplits, ({ one }) => ({
  booking: one(bookings, { fields: [bookingSplits.booking_id], references: [bookings.id] }),
  user: one(users, { fields: [bookingSplits.user_id], references: [users.id] }),
}));

export const expensesRelations = relations(expenses, ({ one, many }) => ({
  trip: one(trips, { fields: [expenses.trip_id], references: [trips.id] }),
  payer: one(users, { fields: [expenses.paid_by], references: [users.id] }),
  splits: many(expenseSplits),
}));

export const expenseSplitsRelations = relations(expenseSplits, ({ one }) => ({
  expense: one(expenses, { fields: [expenseSplits.expense_id], references: [expenses.id] }),
  user: one(users, { fields: [expenseSplits.user_id], references: [users.id] }),
}));

export const settlementsRelations = relations(settlements, ({ one }) => ({
  trip: one(trips, { fields: [settlements.trip_id], references: [trips.id] }),
  fromUser: one(users, { fields: [settlements.from_user], references: [users.id] }),
  toUser: one(users, { fields: [settlements.to_user], references: [users.id] }),
}));

export const bookingAttachmentsRelations = relations(bookingAttachments, ({ one }) => ({
  booking: one(bookings, {
    fields: [bookingAttachments.booking_id],
    references: [bookings.id],
  }),
  uploadedBy: one(users, {
    fields: [bookingAttachments.uploaded_by],
    references: [users.id],
  }),
}));

export const todosRelations = relations(todos, ({ one }) => ({
  trip: one(trips, { fields: [todos.trip_id], references: [trips.id] }),
  assignee: one(users, { fields: [todos.assignee_id], references: [users.id] }),
}));

export const dayNotesRelations = relations(dayNotes, ({ one }) => ({
  trip: one(trips, { fields: [dayNotes.trip_id], references: [trips.id] }),
}));

export const dayRemindersRelations = relations(dayReminders, ({ one }) => ({
  trip: one(trips, { fields: [dayReminders.trip_id], references: [trips.id] }),
}));

/* ---------------------------------- types ---------------------------------- */

export type TripRole = (typeof tripRole.enumValues)[number];
export type TodoStatus = (typeof todoStatus.enumValues)[number];
export type Trip = typeof trips.$inferSelect;
export type TripMember = typeof tripMembers.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;
export type BookingAttachment = typeof bookingAttachments.$inferSelect;
export type NewBookingAttachment = typeof bookingAttachments.$inferInsert;
export type Todo = typeof todos.$inferSelect;
export type NewTodo = typeof todos.$inferInsert;
export type DayNote = typeof dayNotes.$inferSelect;
export type DayReminder = typeof dayReminders.$inferSelect;
export type NewDayReminder = typeof dayReminders.$inferInsert;
export type TripParty = typeof tripParties.$inferSelect;
export type NewTripParty = typeof tripParties.$inferInsert;
export type BookingSplit = typeof bookingSplits.$inferSelect;
export type NewBookingSplit = typeof bookingSplits.$inferInsert;
export type Expense = typeof expenses.$inferSelect;
export type NewExpense = typeof expenses.$inferInsert;
export type ExpenseSplit = typeof expenseSplits.$inferSelect;
export type NewExpenseSplit = typeof expenseSplits.$inferInsert;
export type Settlement = typeof settlements.$inferSelect;
export type NewSettlement = typeof settlements.$inferInsert;
export type FxRate = typeof fxRates.$inferSelect;
export type NewFxRate = typeof fxRates.$inferInsert;
