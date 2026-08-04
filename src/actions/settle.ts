"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, tables, transaction } from "@/db";
import { runAction } from "@/lib/action-utils";
import { requireTripAccess, WRITE_ROLES } from "@/lib/authz";
import { settlementInsertSchema } from "@/lib/schemas";
import { AppError } from "@/lib/errors";
import { recordCreated, recordDeleted, settlementLabel, userLabels } from "@/lib/audit";

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
    const row = await transaction(async (tx) => {
      const [inserted] = await tx
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
      // A swallowed insert returns no row; hand back the payment already on
      // record so a retry is indistinguishable from the attempt that got
      // through — and, crucially, log nothing, or the retry reads as a second
      // payback in the feed.
      if (!inserted) {
        const [already] = await tx
          .select()
          .from(tables.settlements)
          .where(eq(tables.settlements.id, id))
          .limit(1);
        return already;
      }
      const names = await userLabels(tx, [inserted.from_user, inserted.to_user]);
      await recordCreated(
        tx,
        user,
        {
          trip_id: inserted.trip_id,
          entity_type: "settlement",
          entity_id: inserted.id,
          entity_label: settlementLabel(
            inserted,
            names.get(inserted.from_user) ?? "Someone",
            names.get(inserted.to_user) ?? "Someone",
          ),
        },
        [inserted.from_user, inserted.to_user],
      );
      return inserted;
    });
    revalidateApp();
    return row;
  });
}

export async function deleteSettlementAction(id: string) {
  return runAction(async (user) => {
    const [existing] = await db
      .select()
      .from(tables.settlements)
      .where(eq(tables.settlements.id, id))
      .limit(1);
    if (!existing) return { id };
    await requireTripAccess(user.id, existing.trip_id, WRITE_ROLES);
    // The highest-stakes event in the app: deleting a payback silently shifts
    // everyone's balance and leaves nothing behind. So the entry carries the
    // full detail — amount, currency and both ends, by name AND by id — and
    // commits in the same transaction as the delete.
    await transaction(async (tx) => {
      const names = await userLabels(tx, [existing.from_user, existing.to_user]);
      await tx.delete(tables.settlements).where(eq(tables.settlements.id, id));
      await recordDeleted(
        tx,
        user,
        {
          trip_id: existing.trip_id,
          entity_type: "settlement",
          entity_id: id,
          entity_label: settlementLabel(
            existing,
            names.get(existing.from_user) ?? "Someone",
            names.get(existing.to_user) ?? "Someone",
          ),
        },
        [existing.from_user, existing.to_user],
      );
    });
    revalidateApp();
    return { id };
  });
}
