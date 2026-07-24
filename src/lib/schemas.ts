import { z } from "zod";
import { CURRENCIES } from "./currencies";

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

const bookingBaseShape = {
  id: z.string().optional(),
  trip_id: z.string().uuid(),
  type: bookingTypeSchema,
  title: z.string().min(1),
  start_date: z.string().min(1),
  end_date: z.string().nullish(),
  confirmation_number: z.string().nullish(),
  provider: z.string().nullish(),
  details: z.record(z.string(), z.unknown()).nullish(),
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

export const bookingUpdateSchema = bookingBase
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

export const todoUpdateSchema = todoInsertSchema.partial();

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
