"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, tables } from "@/db";
import { runAction } from "@/lib/action-utils";
import { requireTripAccess, WRITE_ROLES } from "@/lib/authz";
import { dayNoteUpsertSchema } from "@/lib/schemas";

const revalidateApp = () => revalidatePath("/", "layout");

export async function upsertDayNoteAction(input: unknown) {
  return runAction(async (user) => {
    const { date, title, trip_id } = dayNoteUpsertSchema.parse(input);
    await requireTripAccess(user.id, trip_id, WRITE_ROLES);

    // Empty title deletes the note.
    if (!title.trim()) {
      await db
        .delete(tables.dayNotes)
        .where(and(eq(tables.dayNotes.date, date), eq(tables.dayNotes.trip_id, trip_id)));
      revalidateApp();
      return null;
    }

    // One statement rather than check-then-insert: two members editing the same
    // day (or one member on two devices) would both find no row and both insert.
    // The uq_day_notes_trip_date index is what makes the conflict target valid.
    const [row] = await db
      .insert(tables.dayNotes)
      .values({
        id: crypto.randomUUID(),
        date,
        title: title.trim(),
        trip_id,
      })
      .onConflictDoUpdate({
        target: [tables.dayNotes.trip_id, tables.dayNotes.date],
        set: { title: title.trim() },
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
    await requireTripAccess(user.id, existing.trip_id, WRITE_ROLES);
    await db.delete(tables.dayNotes).where(eq(tables.dayNotes.id, id));
    revalidateApp();
    return { id };
  });
}
