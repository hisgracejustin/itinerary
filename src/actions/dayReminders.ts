"use server";

import { eq } from "drizzle-orm";
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
    const [row] = await db
      .insert(tables.dayReminders)
      .values({
        id: data.id || crypto.randomUUID(),
        date: data.date,
        trip_id: data.trip_id ?? null,
        text: data.text,
        time: data.time ?? null,
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
