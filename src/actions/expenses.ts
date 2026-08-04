"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, tables, transaction, type Db } from "@/db";
import { runAction } from "@/lib/action-utils";
import { requireTripAccess, requireTripMembers, WRITE_ROLES } from "@/lib/authz";
import { expenseInsertSchema, expenseUpdateSchema } from "@/lib/schemas";
import { AppError } from "@/lib/errors";
import {
  expenseAuditChanges,
  recordChanges,
  recordCreated,
  recordDeleted,
  type ExpenseSnapshot,
} from "@/lib/audit";

const revalidateApp = () => revalidatePath("/", "layout");

/**
 * Replace-all split rows for an expense. `splits === undefined` leaves existing
 * rows untouched; `splits: []` un-splits; a non-empty set replaces wholesale.
 */
async function replaceExpenseSplits(
  client: Db,
  expenseId: string,
  splits: { user_id: string; weight: number; extra_amount?: number }[] | undefined,
) {
  if (splits === undefined) return;
  await client.delete(tables.expenseSplits).where(eq(tables.expenseSplits.expense_id, expenseId));
  if (splits.length > 0) {
    await client.insert(tables.expenseSplits).values(
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
    // Expense row + its split rows commit together (a partial write leaves a
    // shared cost with no splits, silently dropping it from everyone's balances).
    const row = await transaction(async (tx) => {
      const [inserted] = await tx
        .insert(tables.expenses)
        .values({
          trip_id: data.trip_id,
          title: data.title,
          amount: data.amount,
          currency: data.currency,
          paid_by: data.paid_by ?? null,
          created_by: user.id,
          date: data.date ?? null,
          charged_currency: data.charged_currency ?? null,
          charged_rate: data.charged_rate ?? null,
        })
        .returning();
      await replaceExpenseSplits(tx, inserted.id, data.splits);
      await recordCreated(tx, user, {
        trip_id: inserted.trip_id,
        entity_type: "expense",
        entity_id: inserted.id,
        entity_label: inserted.title,
      });
      return inserted;
    });
    revalidateApp();
    return row;
  });
}

export async function updateExpenseAction(id: string, input: unknown) {
  return runAction(async (user) => {
    const parsed = expenseUpdateSchema.parse(input);
    const { splits, ...updates } = parsed;
    // Whole row: it doubles as the "before" half of the audit diff (see
    // updateBookingAction).
    const [existing] = await db
      .select()
      .from(tables.expenses)
      .where(eq(tables.expenses.id, id))
      .limit(1);
    if (!existing) throw new AppError("Expense not found");
    const existingSplits = await db
      .select({
        user_id: tables.expenseSplits.user_id,
        weight: tables.expenseSplits.weight,
        extra_amount: tables.expenseSplits.extra_amount,
      })
      .from(tables.expenseSplits)
      .where(eq(tables.expenseSplits.expense_id, id));
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
      if (splits === undefined) carriedUserIds.push(...existingSplits.map((r) => r.user_id));
    }
    await requireTripMembers(targetTripId, [
      updates.paid_by,
      ...(splits ?? []).map((s) => s.user_id),
      ...carriedUserIds,
    ]);
    const row = await transaction(async (tx) => {
      let updated;
      if (Object.keys(updates).length > 0) {
        [updated] = await tx
          .update(tables.expenses)
          .set(updates)
          .where(eq(tables.expenses.id, id))
          .returning();
      } else {
        [updated] = await tx.select().from(tables.expenses).where(eq(tables.expenses.id, id)).limit(1);
      }
      await replaceExpenseSplits(tx, id, splits);
      const after: ExpenseSnapshot = { ...updated, splits: splits ?? existingSplits };
      await recordChanges(
        tx,
        user,
        {
          trip_id: after.trip_id,
          entity_type: "expense",
          entity_id: id,
          entity_label: after.title,
        },
        await expenseAuditChanges(tx, { ...existing, splits: existingSplits }, after),
      );
      return updated;
    });
    revalidateApp();
    return row;
  });
}

export async function deleteExpenseAction(id: string) {
  return runAction(async (user) => {
    const [existing] = await db
      .select({ trip_id: tables.expenses.trip_id, title: tables.expenses.title })
      .from(tables.expenses)
      .where(eq(tables.expenses.id, id))
      .limit(1);
    if (!existing) return { id };
    await requireTripAccess(user.id, existing.trip_id, WRITE_ROLES);
    // expense_splits cascade on the FK. The audit row commits with the delete —
    // it's the only record left of what was here.
    await transaction(async (tx) => {
      await tx.delete(tables.expenses).where(eq(tables.expenses.id, id));
      await recordDeleted(tx, user, {
        trip_id: existing.trip_id,
        entity_type: "expense",
        entity_id: id,
        entity_label: existing.title,
      });
    });
    revalidateApp();
    return { id };
  });
}
