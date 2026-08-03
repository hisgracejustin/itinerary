"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, tables } from "@/db";
import { runAction } from "@/lib/action-utils";
import { requireTripAccess, WRITE_ROLES } from "@/lib/authz";
import { settlementInsertSchema } from "@/lib/schemas";
import { AppError } from "@/lib/errors";

const revalidateApp = () => revalidatePath("/", "layout");

export async function recordSettlementAction(input: unknown) {
  return runAction(async (user) => {
    const data = settlementInsertSchema.parse(input);
    await requireTripAccess(user.id, data.trip_id, WRITE_ROLES);

    // Both parties must be members of this trip; and they must not share a party
    // — an intra-party settlement has zero effect on unit balances (decision 5).
    const rows = await db
      .select({
        user_id: tables.tripMembers.user_id,
        party_id: tables.tripMembers.party_id,
      })
      .from(tables.tripMembers)
      .where(
        and(
          eq(tables.tripMembers.trip_id, data.trip_id),
          inArray(tables.tripMembers.user_id, [data.from_user, data.to_user]),
        ),
      );
    const from = rows.find((r) => r.user_id === data.from_user);
    const to = rows.find((r) => r.user_id === data.to_user);
    if (!from || !to) throw new AppError("Both people must be members of this trip");
    if (from.party_id && to.party_id && from.party_id === to.party_id) {
      throw new AppError("Those two are in the same party — settling between them has no effect");
    }

    // The client sends one id per submission attempt, so a retry lands on the
    // primary key it already wrote and does nothing rather than duplicating a
    // payback — which would silently shift every downstream balance with no way
    // to tell it apart from a genuine second payment.
    const id = data.id ?? crypto.randomUUID();
    const [inserted] = await db
      .insert(tables.settlements)
      .values({
        id,
        trip_id: data.trip_id,
        from_user: data.from_user,
        to_user: data.to_user,
        amount: data.amount,
        currency: data.currency,
        note: data.note ?? null,
      })
      .onConflictDoNothing({ target: tables.settlements.id })
      .returning();
    // A swallowed insert returns no row; hand back the payment already on record
    // so a retry is indistinguishable from the attempt that got through.
    const [row] = inserted
      ? [inserted]
      : await db
          .select()
          .from(tables.settlements)
          .where(eq(tables.settlements.id, id))
          .limit(1);
    revalidateApp();
    return row;
  });
}

export async function deleteSettlementAction(id: string) {
  return runAction(async (user) => {
    const [existing] = await db
      .select({ trip_id: tables.settlements.trip_id })
      .from(tables.settlements)
      .where(eq(tables.settlements.id, id))
      .limit(1);
    if (!existing) return { id };
    await requireTripAccess(user.id, existing.trip_id, WRITE_ROLES);
    await db.delete(tables.settlements).where(eq(tables.settlements.id, id));
    revalidateApp();
    return { id };
  });
}
