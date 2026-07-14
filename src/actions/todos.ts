"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, tables } from "@/db";
import { runAction } from "@/lib/action-utils";
import { requireTripAccess, WRITE_ROLES } from "@/lib/authz";
import { todoInsertSchema, todoUpdateSchema } from "@/lib/schemas";

const revalidateApp = () => revalidatePath("/", "layout");

export async function createTodoAction(input: unknown) {
  return runAction(async (user) => {
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
    revalidateApp();
    return row;
  });
}

export async function updateTodoAction(id: string, input: unknown) {
  return runAction(async (user) => {
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
    if (existing.trip_id) await requireTripAccess(user.id, existing.trip_id, WRITE_ROLES);
    await db.delete(tables.todos).where(eq(tables.todos.id, id));
    revalidateApp();
    return { id };
  });
}
