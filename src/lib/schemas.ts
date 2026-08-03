import { z } from "zod";
import { CURRENCIES } from "./currencies";
import { sanitizeCancellationPolicy } from "./cancellation";
// The same guard the AI parser and the booking form apply: only a zone this
// runtime actually knows may reach the column, because a bad one is read as fact
// by every cancellation-cutoff comparison on the booking.
import { SUPPORTED_ZONES } from "./timezones";

export const bookingTypeSchema = z.enum([
  "flight",
  "train",
  "bus",
  "cruise",
  "hotel",
  "activity",
  "rental",
]);

// A known-currency guard shared by expenses/settlements. Bookings keep a looser
// `cost_currency: string` for back-compat with historical rows.
const CURRENCY_CODES = CURRENCIES.map((c) => c.code) as [string, ...string[]];
const currencySchema = z.enum(CURRENCY_CODES);

// One person's share of a split. user_id is a text user id (cuid2 / preserved
// Supabase UUID), so no .uuid(). `weight` must be ≥ 0 and `extra_amount` ≥ 0,
// with each entry carrying weight > 0 OR extra_amount > 0 — an extras-only
// participant (someone who only owes their itemized extra) sits at weight 0.
export const splitEntrySchema = z
  .object({
    user_id: z.string().min(1),
    weight: z.number().min(0),
    extra_amount: z.number().min(0).default(0),
  })
  .refine((s) => s.weight > 0 || s.extra_amount > 0, {
    path: ["weight"],
    message: "Each person needs a weight or an extra amount",
  });

// Splits without a payer break the zero-sum invariant, so any non-empty split
// set requires a payer (client + this Zod rule both enforce it).
function requirePayerWhenSplit(
  data: {
    paid_by?: string | null;
    splits?: { user_id: string; weight: number; extra_amount?: number }[];
  },
  ctx: z.RefinementCtx,
) {
  if (data.splits && data.splits.length > 0 && !data.paid_by) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["paid_by"],
      message: "Pick who paid before splitting this cost",
    });
  }
}

// An item's exact charged currency + rate must be set together or not at all,
// and the charged currency must differ from the item's own native currency.
// `nativeKey` names the field carrying the native currency (cost_currency for
// bookings, currency for expenses). On updates that don't send the native
// currency, the difference check is skipped — the server lacks the context, and
// the form always sends both.
function requireChargedRatePair(
  data: {
    charged_currency?: string | null;
    charged_rate?: number | null;
    cost_currency?: string | null;
    currency?: string | null;
  },
  ctx: z.RefinementCtx,
  nativeKey: "cost_currency" | "currency",
) {
  const cc = data.charged_currency;
  const cr = data.charged_rate;
  const hasCcy = cc != null && cc !== "";
  const hasRate = cr != null;
  if (hasCcy !== hasRate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [hasCcy ? "charged_rate" : "charged_currency"],
      message: "Set both a charged currency and rate, or neither",
    });
    return;
  }
  if (!hasCcy) return;
  const native = data[nativeKey];
  if (native != null && native !== "" && cc === native) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["charged_currency"],
      message: "Charged currency must differ from the item's own currency",
    });
  }
}

// A booking's `details` is a free-form record, but `maps_url` is rendered as an
// anchor href in the calendar/booking views. It can arrive from the AI parser,
// which is instructed to *generate* a Maps URL from document content — a hostile
// booking document could inject a `javascript:` scheme (stored XSS run in the app
// origin for every trip member). Drop any non-http(s) maps_url rather than fail
// the whole save, so a bad parser value doesn't block a legitimate booking. (H5)
function stripUnsafeMapsUrl(details: Record<string, unknown>) {
  const url = details.maps_url;
  if (typeof url === "string" && !/^https?:\/\//i.test(url)) {
    const rest = { ...details };
    delete rest.maps_url;
    return rest;
  }
  return details;
}

// `details` also carries `cancellation_policy` — refund tiers or the
// 'non_refundable' marker — which the booking modal and the refundable view on
// /costs read. Re-sanitize it on every write with the same helper the form and
// the AI parser use, so a malformed tier from any of the three entry points
// can't reach the jsonb column.
function sanitizeDetails(details: Record<string, unknown>) {
  const stripped = stripUnsafeMapsUrl(details);
  if (!("cancellation_policy" in stripped)) return stripped;
  const policy = sanitizeCancellationPolicy(stripped.cancellation_policy);
  const next = { ...stripped };
  if (policy) next.cancellation_policy = policy;
  else delete next.cancellation_policy;
  return next;
}

// Booking dates are naive wall clock — the clock on the wall where the booking
// happens, with the zone carried separately in `timezone`. A trailing Z or
// ±HH:MM turns the value into an absolute instant, which then renders as a
// different time (sometimes a different DAY) for every viewer, and which the
// edit form would rewrite to the editing device's clock on the next save.
// Three rows entered before this was enforced had to be repaired by hand; this
// is the boundary that stops a fourth.
const OFFSET_SUFFIX = /(Z|[+-]\d{2}:?\d{2})$/;
const wallClock = (schema: z.ZodString) =>
  schema.refine(
    (s) => !OFFSET_SUFFIX.test(s),
    "Dates are stored as wall clock — drop the timezone suffix and set the booking's timezone instead",
  );

const bookingBaseShape = {
  id: z.string().optional(),
  trip_id: z.string().uuid(),
  type: bookingTypeSchema,
  title: z.string().min(1),
  start_date: wallClock(z.string().min(1)),
  end_date: wallClock(z.string()).nullish(),
  // The provider's clock for this booking's times and cutoffs. Required on
  // create — a booking with no zone is one whose cancellation deadline we can
  // only guess at, and the form always arrives pre-filled, so there is no case
  // where a person has to supply this from nothing. bookingUpdateSchema is
  // `.partial()`, so an edit that doesn't mention it leaves it untouched.
  // The COLUMN is still nullable: rows written before this existed are filled
  // by scripts/infer-timezones.mjs, and NOT NULL follows that backfill.
  timezone: z.string().refine((tz) => SUPPORTED_ZONES.has(tz), "Unknown timezone"),
  confirmation_number: z.string().nullish(),
  provider: z.string().nullish(),
  details: z.record(z.string(), z.unknown()).transform(sanitizeDetails).nullish(),
  cost_amount: z.number().nullish(),
  cost_currency: z.string().nullish(),
  cost_share: z.number().nullish(),
  // Who fronted the cost. null clears it; undefined leaves it untouched on update.
  paid_by: z.string().min(1).nullish(),
  // Replace-all split set. `[]` un-splits; `undefined` leaves existing rows
  // untouched (see the booking action).
  splits: z.array(splitEntrySchema).optional(),
  // Exact charged currency + rate (see requireChargedRatePair). Both null/absent
  // clears; both set re-denominates the settlement at this rate.
  charged_currency: currencySchema.nullish(),
  charged_rate: z.number().positive().nullish(),
  source: z.enum(["manual", "parsed"]).nullish(),
  source_file: z.string().nullish(),
  raw_text: z.string().nullish(),
};

const bookingBase = z.object(bookingBaseShape);

export const bookingInsertSchema = bookingBase
  .superRefine(requirePayerWhenSplit)
  .superRefine((d, ctx) => requireChargedRatePair(d, ctx, "cost_currency"));

// `id` is omitted (not just optional): the row to update is addressed by the
// action's own id argument, so an `id` in the payload could only rewrite a
// primary key from the client.
export const bookingUpdateSchema = bookingBase
  .omit({ id: true })
  .partial()
  .superRefine(requirePayerWhenSplit)
  .superRefine((d, ctx) => requireChargedRatePair(d, ctx, "cost_currency"));

// Ad-hoc shared cost. Splits are required and non-empty (an expense with nobody
// to split is meaningless), so a payer is always required too.
export const expenseInsertSchema = z
  .object({
    trip_id: z.string().uuid(),
    title: z.string().min(1),
    amount: z.number().positive(),
    currency: currencySchema,
    paid_by: z.string().min(1).nullish(),
    date: z.string().nullish(),
    splits: z.array(splitEntrySchema).min(1),
    charged_currency: currencySchema.nullish(),
    charged_rate: z.number().positive().nullish(),
  })
  .superRefine(requirePayerWhenSplit)
  .superRefine((d, ctx) => requireChargedRatePair(d, ctx, "currency"));

export const expenseUpdateSchema = z
  .object({
    trip_id: z.string().uuid().optional(),
    title: z.string().min(1).optional(),
    amount: z.number().positive().optional(),
    currency: currencySchema.optional(),
    paid_by: z.string().min(1).nullish(),
    date: z.string().nullish(),
    // Replace-all, like bookings: `[]` un-splits, `undefined` leaves rows alone.
    splits: z.array(splitEntrySchema).optional(),
    charged_currency: currencySchema.nullish(),
    charged_rate: z.number().positive().nullish(),
  })
  .superRefine(requirePayerWhenSplit)
  .superRefine((d, ctx) => requireChargedRatePair(d, ctx, "currency"));

// A recorded pay-back, person-to-person. Same-person is nonsensical.
export const settlementInsertSchema = z
  .object({
    // Minted by the client, once per form submission, so a retry of the SAME
    // payment (lost response on flaky data, a Server Action retry, a
    // back-forward re-post) collides with the row it already wrote instead of
    // recording the payback twice. INSERT only — an update still addresses its
    // row by the action's id argument (see bookingUpdateSchema).
    id: z.string().uuid().optional(),
    trip_id: z.string().uuid(),
    from_user: z.string().min(1),
    to_user: z.string().min(1),
    amount: z.number().positive(),
    currency: currencySchema,
    note: z.string().nullish(),
  })
  .refine((d) => d.from_user !== d.to_user, {
    path: ["to_user"],
    message: "A settlement needs two different people",
  });

// Settlement unit (couple/group) for a trip. member_ids assigns the party to
// those members in one shot; a member belongs to at most one party.
export const partySchema = z.object({
  trip_id: z.string().uuid(),
  name: z.string().min(1),
  member_ids: z.array(z.string().min(1)).default([]),
});

export const todoStatusSchema = z.enum(["todo", "in_progress", "done"]);

export const todoInsertSchema = z.object({
  id: z.string().optional(),
  trip_id: z.string().uuid(),
  title: z.string().min(1),
  due_date: z.string().nullish(),
  status: todoStatusSchema.optional(),
  // users.id is a text column (cuid2, or a preserved Supabase UUID) — not
  // necessarily a UUID, so no .uuid() here. null = unassigned.
  assignee_id: z.string().min(1).nullish(),
  position: z.number().int().optional(),
});

// See bookingUpdateSchema — the id argument addresses the row, never the body.
export const todoUpdateSchema = todoInsertSchema.omit({ id: true }).partial();

// Payload for moving a to-do between board columns (and reordering within one).
export const todoMoveSchema = z.object({
  id: z.string().min(1),
  status: todoStatusSchema,
  // Full ordered id list of the DESTINATION column after the drop (must
  // include `id`). Omitted => append to the end of the destination column.
  orderedIds: z.array(z.string()).min(1).optional(),
});

export const dayNoteUpsertSchema = z.object({
  date: z.string().min(1),
  title: z.string(),
  trip_id: z.string().uuid(),
});

// Per-day free-form reminders (a list per day, distinct from the day title).
const timeField = z.string().regex(/^\d{2}:\d{2}$/, "Expected HH:MM").nullish();
export const dayReminderInsertSchema = z.object({
  id: z.string().optional(),
  date: z.string().min(1),
  trip_id: z.string().uuid(),
  text: z.string().min(1),
  time: timeField,
  position: z.number().int().optional(),
});
export const dayReminderUpdateSchema = z.object({
  text: z.string().min(1).optional(),
  time: timeField,
});

export const tripInsertSchema = z.object({
  name: z.string().min(1),
  start_date: z.string().min(1),
  end_date: z.string().min(1),
});

export const tripUpdateSchema = tripInsertSchema.partial();
