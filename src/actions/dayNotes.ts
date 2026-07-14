"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, tables } from "@/db";
import { runAction } from "@/lib/action-utils";
import { requireTripAccess, WRITE_ROLES } from "@/lib/authz";
import { dayNoteUpsertSchema } from "@/lib/schemas";

const revalidateApp = () => revalidatePath("/", "layout");

export async function upsertDayNoteAction(input: unknown) {
  return runAction(async (user) => {
    const { date, title, trip_id } = dayNoteUpsertSchema.parse(input);
    if (trip_id) await requireTripAccess(user.id, trip_id, WRITE_ROLES);

    const match = trip_id
      ? and(eq(tables.dayNotes.date, date), eq(tables.dayNotes.trip_id, trip_id))
      : and(eq(tables.dayNotes.date, date), isNull(tables.dayNotes.trip_id));
    const [existing] = await db.select().from(tables.dayNotes).where(match).limit(1);

    // Empty title deletes the note.
    if (!title.trim()) {
      if (existing) await db.delete(tables.dayNotes).where(eq(tables.dayNotes.id, existing.id));
      revalidateApp();
      return null;
    }

    if (existing) {
      const [row] = await db
        .update(tables.dayNotes)
        .set({ title: title.trim() })
        .where(eq(tables.dayNotes.id, existing.id))
        .returning();
      revalidateApp();
      return row;
    }
    const [row] = await db
      .insert(tables.dayNotes)
      .values({
        id: crypto.randomUUID(),
        date,
        title: title.trim(),
        trip_id: trip_id ?? null,
      })
      .returning();
    revalidateApp();
    return row;
  });
}

export async function deleteDayNoteAction(id: string) {
  return runAction(async (user) => {
    const [existing] = await db
      .select({ trip_id: tables.dayNotes.trip_id })
      .from(tables.dayNotes)
      .where(eq(tables.dayNotes.id, id))
      .limit(1);
    if (!existing) return { id };
    if (existing.trip_id) await requireTripAccess(user.id, existing.trip_id, WRITE_ROLES);
    await db.delete(tables.dayNotes).where(eq(tables.dayNotes.id, id));
    revalidateApp();
    return { id };
  });
}
