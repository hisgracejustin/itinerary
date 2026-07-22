import { z } from "zod";

export const bookingTypeSchema = z.enum([
  "flight",
  "train",
  "bus",
  "cruise",
  "hotel",
  "activity",
  "rental",
]);

export const bookingInsertSchema = z.object({
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
  source: z.enum(["manual", "parsed"]).nullish(),
  source_file: z.string().nullish(),
  raw_text: z.string().nullish(),
});

export const bookingUpdateSchema = bookingInsertSchema.partial();

export const todoInsertSchema = z.object({
  id: z.string().optional(),
  trip_id: z.string().uuid(),
  title: z.string().min(1),
  due_date: z.string().nullish(),
  completed: z.boolean().optional(),
  // users.id is a text column (cuid2, or a preserved Supabase UUID) — not
  // necessarily a UUID, so no .uuid() here. null = unassigned.
  assignee_id: z.string().min(1).nullish(),
  position: z.number().int().optional(),
});

export const todoUpdateSchema = todoInsertSchema.partial();

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
