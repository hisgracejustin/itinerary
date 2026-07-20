import {
  boolean,
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
]);
export const bookingSource = pgEnum("booking_source", ["manual", "parsed"]);

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
    completed: boolean("completed").notNull().default(false),
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
}));

export const tripMembersRelations = relations(tripMembers, ({ one }) => ({
  trip: one(trips, { fields: [tripMembers.trip_id], references: [trips.id] }),
  user: one(users, { fields: [tripMembers.user_id], references: [users.id] }),
}));

export const bookingsRelations = relations(bookings, ({ one, many }) => ({
  trip: one(trips, { fields: [bookings.trip_id], references: [trips.id] }),
  attachments: many(bookingAttachments),
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
