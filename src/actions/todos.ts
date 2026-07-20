"use server";

import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db, tables } from "@/db";
import { runAction } from "@/lib/action-utils";
import { requireAssignable, requireTripAccess, WRITE_ROLES } from "@/lib/authz";
import { todoInsertSchema, todoUpdateSchema } from "@/lib/schemas";

const revalidateApp = () => revalidatePath("/", "layout");

export async function createTodoAction(input: unknown) {
  return runAction(async (user) => {
    const data = todoInsertSchema.parse(input);
    await requireTripAccess(user.id, data.trip_id, WRITE_ROLES);
    await requireAssignable(user.id, data.assignee_id, data.trip_id);
    // Append to the end of the list unless the client sent an explicit position
    // (it does, so the optimistic row lands where the persisted one will).
    let position = data.position;
    if (position == null) {
      const [{ next } = { next: 0 }] = await db
        .select({ next: sql<number>`coalesce(max(${tables.todos.position}), -1) + 1` })
        .from(tables.todos);
      position = next;
    }
    const [row] = await db
      .insert(tables.todos)
      .values({
        id: data.id || crypto.randomUUID(),
        trip_id: data.trip_id,
        title: data.title,
        due_date: data.due_date ?? null,
        completed: data.completed ?? false,
        assignee_id: data.assignee_id ?? null,
        position,
      })
      .returning();
    revalidateApp();
    return row;
  });
}

export async function updateTodoAction(id: string, input: unknown) {
  return runAction(async (user) => {
    const updates = todoUpdateSchema.parse(input);
    const [existing] = await db
      .select({ trip_id: tables.todos.trip_id, assignee_id: tables.todos.assignee_id })
      .from(tables.todos)
      .where(eq(tables.todos.id, id))
      .limit(1);
    if (!existing) throw new Error("To-do not found");
    await requireTripAccess(user.id, existing.trip_id, WRITE_ROLES);
    // Moving a todo onto a different trip requires write access to the target
    // trip too — otherwise the existing-trip check alone would let a member of
    // trip A reassign a todo into trip B they can't write.
    if (updates.trip_id && updates.trip_id !== existing.trip_id) {
      await requireTripAccess(user.id, updates.trip_id, WRITE_ROLES);
    }

    const patch = { ...updates };
    const tripChanged =
      updates.trip_id !== undefined && (updates.trip_id ?? null) !== existing.trip_id;
    const targetTrip = updates.trip_id !== undefined ? updates.trip_id : existing.trip_id;
    // Validate the assignee against the trip the to-do will end up on, not the
    // one it's currently on — a single update can change both at once.
    if (updates.assignee_id !== undefined) {
      await requireAssignable(user.id, updates.assignee_id, targetTrip);
    } else if (tripChanged && existing.assignee_id) {
      // Trip moved without touching the assignee: the current assignee may not
      // be a member of the destination. Drop the assignment rather than leave a
      // to-do owned by someone who can't see it.
      try {
        await requireAssignable(user.id, existing.assignee_id, targetTrip);
      } catch {
        patch.assignee_id = null;
      }
    }

    const [row] = await db
      .update(tables.todos)
      .set(patch)
      .where(eq(tables.todos.id, id))
      .returning();
    revalidateApp();
    return row;
  });
}

export async function deleteTodoAction(id: string) {
  return runAction(async (user) => {
    const [existing] = await db
      .select({ trip_id: tables.todos.trip_id })
      .from(tables.todos)
      .where(eq(tables.todos.id, id))
      .limit(1);
    if (!existing) return { id };
    await requireTripAccess(user.id, existing.trip_id, WRITE_ROLES);
    await db.delete(tables.todos).where(eq(tables.todos.id, id));
    revalidateApp();
    return { id };
  });
}

const reorderSchema = z.array(z.string()).min(1);

export async function reorderTodosAction(orderedIds: unknown) {
  return runAction(async (user) => {
    const ids = reorderSchema.parse(orderedIds);
    // Only touch rows that actually exist, and require write access to every
    // distinct trip involved so a member of one trip can't reshuffle another's.
    const rows = await db
      .select({ id: tables.todos.id, trip_id: tables.todos.trip_id })
      .from(tables.todos)
      .where(inArray(tables.todos.id, ids));
    const tripIds = [...new Set(rows.map((r) => r.trip_id).filter(Boolean) as string[])];
    for (const tripId of tripIds) await requireTripAccess(user.id, tripId, WRITE_ROLES);

    // Reassign positions in one statement: position = the id's index in `ids`.
    // Rows not present in `ids` keep their current position.
    const known = new Set(rows.map((r) => r.id));
    const present = ids.filter((id) => known.has(id));
    if (present.length === 0) return { ok: true };
    const cases = sql.join(
      present.map((id, i) => sql`when ${id} then ${i}`),
      sql` `,
    );
    await db
      .update(tables.todos)
      .set({ position: sql`case ${tables.todos.id} ${cases} else ${tables.todos.position} end` })
      .where(inArray(tables.todos.id, present));
    revalidateApp();
    return { ok: true };
  });
}
