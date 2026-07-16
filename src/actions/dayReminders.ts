"use server";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db, tables } from "@/db";
import { runAction } from "@/lib/action-utils";
import { requireTripAccess, WRITE_ROLES } from "@/lib/authz";
import { dayReminderInsertSchema, dayReminderUpdateSchema } from "@/lib/schemas";

const revalidateApp = () => revalidatePath("/", "layout");

export async function createDayReminderAction(input: unknown) {
  return runAction(async (user) => {
    const data = dayReminderInsertSchema.parse(input);
    if (data.trip_id) await requireTripAccess(user.id, data.trip_id, WRITE_ROLES);
    // Append to the end of this day's list unless the client sent a position.
    let position = data.position;
    if (position == null) {
      const tripMatch = data.trip_id
        ? eq(tables.dayReminders.trip_id, data.trip_id)
        : isNull(tables.dayReminders.trip_id);
      const [{ next } = { next: 0 }] = await db
        .select({ next: sql<number>`coalesce(max(${tables.dayReminders.position}), -1) + 1` })
        .from(tables.dayReminders)
        .where(and(eq(tables.dayReminders.date, data.date), tripMatch));
      position = next;
    }
    const [row] = await db
      .insert(tables.dayReminders)
      .values({
        id: data.id || crypto.randomUUID(),
        date: data.date,
        trip_id: data.trip_id ?? null,
        text: data.text,
        time: data.time ?? null,
        position,
      })
      .returning();
    revalidateApp();
    return row;
  });
}

export async function updateDayReminderAction(id: string, input: unknown) {
  return runAction(async (user) => {
    const updates = dayReminderUpdateSchema.parse(input);
    const [existing] = await db
      .select({ trip_id: tables.dayReminders.trip_id })
      .from(tables.dayReminders)
      .where(eq(tables.dayReminders.id, id))
      .limit(1);
    if (!existing) throw new Error("Reminder not found");
    if (existing.trip_id) await requireTripAccess(user.id, existing.trip_id, WRITE_ROLES);
    const [row] = await db
      .update(tables.dayReminders)
      .set(updates)
      .where(eq(tables.dayReminders.id, id))
      .returning();
    revalidateApp();
    return row;
  });
}

export async function deleteDayReminderAction(id: string) {
  return runAction(async (user) => {
    const [existing] = await db
      .select({ trip_id: tables.dayReminders.trip_id })
      .from(tables.dayReminders)
      .where(eq(tables.dayReminders.id, id))
      .limit(1);
    if (!existing) return { id };
    if (existing.trip_id) await requireTripAccess(user.id, existing.trip_id, WRITE_ROLES);
    await db.delete(tables.dayReminders).where(eq(tables.dayReminders.id, id));
    revalidateApp();
    return { id };
  });
}

const reorderSchema = z.array(z.string()).min(1);

export async function reorderDayRemindersAction(orderedIds: unknown) {
  return runAction(async (user) => {
    const ids = reorderSchema.parse(orderedIds);
    const rows = await db
      .select({ id: tables.dayReminders.id, trip_id: tables.dayReminders.trip_id })
      .from(tables.dayReminders)
      .where(inArray(tables.dayReminders.id, ids));
    const tripIds = [...new Set(rows.map((r) => r.trip_id).filter(Boolean) as string[])];
    for (const tripId of tripIds) await requireTripAccess(user.id, tripId, WRITE_ROLES);

    const known = new Set(rows.map((r) => r.id));
    const present = ids.filter((id) => known.has(id));
    if (present.length === 0) return { ok: true };
    const cases = sql.join(
      present.map((id, i) => sql`when ${id} then ${i}`),
      sql` `,
    );
    await db
      .update(tables.dayReminders)
      .set({ position: sql`case ${tables.dayReminders.id} ${cases} else ${tables.dayReminders.position} end` })
      .where(inArray(tables.dayReminders.id, present));
    revalidateApp();
    return { ok: true };
  });
}
