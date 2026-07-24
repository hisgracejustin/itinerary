"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, tables } from "@/db";
import { runAction } from "@/lib/action-utils";
import { requireTripAccess, requireTripMembers, WRITE_ROLES } from "@/lib/authz";
import { expenseInsertSchema, expenseUpdateSchema } from "@/lib/schemas";

const revalidateApp = () => revalidatePath("/", "layout");

/**
 * Replace-all split rows for an expense. `splits === undefined` leaves existing
 * rows untouched; `splits: []` un-splits; a non-empty set replaces wholesale.
 */
async function replaceExpenseSplits(
  expenseId: string,
  splits: { user_id: string; weight: number; extra_amount?: number }[] | undefined,
) {
  if (splits === undefined) return;
  await db.delete(tables.expenseSplits).where(eq(tables.expenseSplits.expense_id, expenseId));
  if (splits.length > 0) {
    await db.insert(tables.expenseSplits).values(
      splits.map((s) => ({
        expense_id: expenseId,
        user_id: s.user_id,
        weight: s.weight,
        extra_amount: s.extra_amount ?? 0,
      })),
    );
  }
}

export async function createExpenseAction(input: unknown) {
  return runAction(async (user) => {
    const data = expenseInsertSchema.parse(input);
    await requireTripAccess(user.id, data.trip_id, WRITE_ROLES);
    await requireTripMembers(data.trip_id, [
      data.paid_by,
      ...data.splits.map((s) => s.user_id),
    ]);
    const [row] = await db
      .insert(tables.expenses)
      .values({
        trip_id: data.trip_id,
        title: data.title,
        amount: data.amount,
        currency: data.currency,
        paid_by: data.paid_by ?? null,
        date: data.date ?? null,
        charged_currency: data.charged_currency ?? null,
        charged_rate: data.charged_rate ?? null,
      })
      .returning();
    await replaceExpenseSplits(row.id, data.splits);
    revalidateApp();
    return row;
  });
}

export async function updateExpenseAction(id: string, input: unknown) {
  return runAction(async (user) => {
    const parsed = expenseUpdateSchema.parse(input);
    const { splits, ...updates } = parsed;
    const [existing] = await db
      .select({ trip_id: tables.expenses.trip_id, paid_by: tables.expenses.paid_by })
      .from(tables.expenses)
      .where(eq(tables.expenses.id, id))
      .limit(1);
    if (!existing) throw new Error("Expense not found");
    await requireTripAccess(user.id, existing.trip_id, WRITE_ROLES);
    const movingTrip = !!updates.trip_id && updates.trip_id !== existing.trip_id;
    if (movingTrip) {
      await requireTripAccess(user.id, updates.trip_id!, WRITE_ROLES);
    }
    // Moving with `splits`/`paid_by` omitted carries the existing rows to the new
    // trip, so validate those too — same rule as updateBookingAction.
    const targetTripId = updates.trip_id ?? existing.trip_id;
    const carriedUserIds: (string | null | undefined)[] = [];
    if (movingTrip) {
      if (updates.paid_by === undefined) carriedUserIds.push(existing.paid_by);
      if (splits === undefined) {
        const rows = await db
          .select({ user_id: tables.expenseSplits.user_id })
          .from(tables.expenseSplits)
          .where(eq(tables.expenseSplits.expense_id, id));
        carriedUserIds.push(...rows.map((r) => r.user_id));
      }
    }
    await requireTripMembers(targetTripId, [
      updates.paid_by,
      ...(splits ?? []).map((s) => s.user_id),
      ...carriedUserIds,
    ]);
    let row;
    if (Object.keys(updates).length > 0) {
      [row] = await db
        .update(tables.expenses)
        .set(updates)
        .where(eq(tables.expenses.id, id))
        .returning();
    } else {
      [row] = await db.select().from(tables.expenses).where(eq(tables.expenses.id, id)).limit(1);
    }
    await replaceExpenseSplits(id, splits);
    revalidateApp();
    return row;
  });
}

export async function deleteExpenseAction(id: string) {
  return runAction(async (user) => {
    const [existing] = await db
      .select({ trip_id: tables.expenses.trip_id })
      .from(tables.expenses)
      .where(eq(tables.expenses.id, id))
      .limit(1);
    if (!existing) return { id };
    await requireTripAccess(user.id, existing.trip_id, WRITE_ROLES);
    // expense_splits cascade on the FK.
    await db.delete(tables.expenses).where(eq(tables.expenses.id, id));
    revalidateApp();
    return { id };
  });
}
