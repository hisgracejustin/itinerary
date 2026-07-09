"use server";

import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { db, tables } from "@/db";
import { requireUser, runAction } from "@/lib/action-utils";
import { accessibleTripIds, requireTripAccess, WRITE_ROLES } from "@/lib/authz";
import { todoInsertSchema, todoUpdateSchema } from "@/lib/schemas";

export async function getTodosAction(tripId?: string | null) {
  return runAction(async () => {
    const user = await requireUser();
    if (tripId) {
      await requireTripAccess(user.id, tripId);
      return db
        .select()
        .from(tables.todos)
        .where(eq(tables.todos.trip_id, tripId))
        .orderBy(asc(tables.todos.due_date), asc(tables.todos.created_at));
    }
    // No trip → tripless todos plus todos of any accessible trip.
    const ids = await accessibleTripIds(user.id);
    const filter = ids.length
      ? or(isNull(tables.todos.trip_id), inArray(tables.todos.trip_id, ids))
      : isNull(tables.todos.trip_id);
    return db
      .select()
      .from(tables.todos)
      .where(filter)
      .orderBy(asc(tables.todos.due_date), asc(tables.todos.created_at));
  });
}

export async function createTodoAction(input: unknown) {
  return runAction(async () => {
    const user = await requireUser();
    const data = todoInsertSchema.parse(input);
    if (data.trip_id) await requireTripAccess(user.id, data.trip_id, WRITE_ROLES);
    const [row] = await db
      .insert(tables.todos)
      .values({
        id: data.id || crypto.randomUUID(),
        trip_id: data.trip_id ?? null,
        title: data.title,
        due_date: data.due_date ?? null,
        completed: data.completed ?? false,
      })
      .returning();
    return row;
  });
}

export async function updateTodoAction(id: string, input: unknown) {
  return runAction(async () => {
    const user = await requireUser();
    const updates = todoUpdateSchema.parse(input);
    const [existing] = await db
      .select({ trip_id: tables.todos.trip_id })
      .from(tables.todos)
      .where(eq(tables.todos.id, id))
      .limit(1);
    if (!existing) throw new Error("To-do not found");
    if (existing.trip_id) await requireTripAccess(user.id, existing.trip_id, WRITE_ROLES);
    const [row] = await db
      .update(tables.todos)
      .set(updates)
      .where(eq(tables.todos.id, id))
      .returning();
    return row;
  });
}

export async function deleteTodoAction(id: string) {
  return runAction(async () => {
    const user = await requireUser();
    const [existing] = await db
      .select({ trip_id: tables.todos.trip_id })
      .from(tables.todos)
      .where(eq(tables.todos.id, id))
      .limit(1);
    if (!existing) return { id };
    if (existing.trip_id) await requireTripAccess(user.id, existing.trip_id, WRITE_ROLES);
    await db.delete(tables.todos).where(eq(tables.todos.id, id));
    return { id };
  });
}
