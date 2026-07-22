"use server";

import { eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, tables } from "@/db";
import { runAction } from "@/lib/action-utils";
import { requireAssignable, requireTripAccess, WRITE_ROLES } from "@/lib/authz";
import { todoInsertSchema, todoMoveSchema, todoUpdateSchema } from "@/lib/schemas";

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
        status: data.status ?? "todo",
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

/**
 * Move a to-do to a board column and (optionally) drop it at a precise slot.
 *
 * Two modes:
 *  - `orderedIds` present — the client drag-and-dropped: it's the full ordered
 *    id list of the DESTINATION column after the drop (and must include the
 *    moved id). We rewrite every listed row's `position` to its index and set
 *    the moved row's `status`. This is the old reorderTodosAction's CASE-write,
 *    now scoped to one column and carrying the status change.
 *  - `orderedIds` absent — a checkbox/chevron move (or a move while a filter is
 *    active, where we must not rewrite hidden rows' positions): append the moved
 *    row to the end of the whole table using the same max(position)+1 convention
 *    createTodoAction uses, and set its status.
 */
export async function moveTodoAction(input: unknown) {
  return runAction(async (user) => {
    const { id, status, orderedIds } = todoMoveSchema.parse(input);
    const [existing] = await db
      .select({ trip_id: tables.todos.trip_id })
      .from(tables.todos)
      .where(eq(tables.todos.id, id))
      .limit(1);
    if (!existing) throw new Error("To-do not found");
    await requireTripAccess(user.id, existing.trip_id, WRITE_ROLES);

    if (orderedIds) {
      // The moved card's own slot must be in the destination order.
      if (!orderedIds.includes(id)) throw new Error("Moved to-do missing from order");
      // Only touch rows that actually exist, and require write access to every
      // distinct trip involved so a member of one trip can't reshuffle another's.
      const rows = await db
        .select({ id: tables.todos.id, trip_id: tables.todos.trip_id })
        .from(tables.todos)
        .where(inArray(tables.todos.id, orderedIds));
      const tripIds = [...new Set(rows.map((r) => r.trip_id).filter(Boolean) as string[])];
      for (const tripId of tripIds) await requireTripAccess(user.id, tripId, WRITE_ROLES);

      // Set the moved row's status first (a small dedicated write keeps the
      // CASE position statement simple and untangled from the status change).
      await db.update(tables.todos).set({ status }).where(eq(tables.todos.id, id));

      // Reassign positions in one statement: position = the id's index in the
      // destination order. Rows not present keep their current position.
      const known = new Set(rows.map((r) => r.id));
      const present = orderedIds.filter((x) => known.has(x));
      if (present.length > 0) {
        const cases = sql.join(
          present.map((x, i) => sql`when ${x} then ${i}`),
          sql` `,
        );
        await db
          .update(tables.todos)
          .set({
            position: sql`case ${tables.todos.id} ${cases} else ${tables.todos.position} end`,
          })
          .where(inArray(tables.todos.id, present));
      }
    } else {
      // Append semantics: land at the end of the table (same convention as
      // createTodoAction), so the moved card sits at the bottom of its column.
      const [{ next } = { next: 0 }] = await db
        .select({ next: sql<number>`coalesce(max(${tables.todos.position}), -1) + 1` })
        .from(tables.todos);
      await db
        .update(tables.todos)
        .set({ status, position: next })
        .where(eq(tables.todos.id, id));
    }

    const [row] = await db
      .select()
      .from(tables.todos)
      .where(eq(tables.todos.id, id))
      .limit(1);
    revalidateApp();
    return row;
  });
}
