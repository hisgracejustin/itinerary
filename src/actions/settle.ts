"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, tables, transaction, type Db } from "@/db";
import { runAction, type SessionUser } from "@/lib/action-utils";
import { requireTripAccess, WRITE_ROLES } from "@/lib/authz";
import { settlementGroupInsertSchema, settlementInsertSchema } from "@/lib/schemas";
import { AppError } from "@/lib/errors";
import { recordCreated, recordDeleted, settlementLabel, userLabels } from "@/lib/audit";

const revalidateApp = () => revalidatePath("/", "layout");

type SettlementRow = typeof tables.settlements.$inferSelect;

// The caller may write to the trip, both people are members of it, and they
// don't share a party there — an intra-party settlement has zero effect on unit
// balances (decision 5).
async function assertCanSettle(
  userId: string,
  part: { trip_id: string; from_user: string; to_user: string },
) {
  await requireTripAccess(userId, part.trip_id, WRITE_ROLES);
  const rows = await db
    .select({
      user_id: tables.tripMembers.user_id,
      party_id: tables.tripMembers.party_id,
    })
    .from(tables.tripMembers)
    .where(
      and(
        eq(tables.tripMembers.trip_id, part.trip_id),
        inArray(tables.tripMembers.user_id, [part.from_user, part.to_user]),
      ),
    );
  const from = rows.find((r) => r.user_id === part.from_user);
  const to = rows.find((r) => r.user_id === part.to_user);
  if (!from || !to) throw new AppError("Both people must be members of this trip");
  if (from.party_id && to.party_id && from.party_id === to.party_id) {
    throw new AppError("Those two are in the same party — settling between them has no effect");
  }
}

async function logSettlement(
  tx: Db,
  user: SessionUser,
  row: SettlementRow,
  log: typeof recordCreated | typeof recordDeleted,
) {
  const names = await userLabels(tx, [row.from_user, row.to_user]);
  await log(
    tx,
    user,
    {
      trip_id: row.trip_id,
      entity_type: "settlement",
      entity_id: row.id,
      entity_label: settlementLabel(
        row,
        names.get(row.from_user) ?? "Someone",
        names.get(row.to_user) ?? "Someone",
      ),
    },
    [row.from_user, row.to_user],
  );
}

export async function recordSettlementAction(input: unknown) {
  return runAction(async (user) => {
    const data = settlementInsertSchema.parse(input);
    await assertCanSettle(user.id, data);

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
      await logSettlement(tx, user, inserted, recordCreated);
      return inserted;
    });
    revalidateApp();
    return row;
  });
}

/**
 * One payment covering several trips: one row per trip, sharing a group id, all
 * written in one transaction so a payment never lands half-recorded. Every part
 * is checked like a single payment, and each trip's feed logs its own part.
 */
export async function recordSettlementGroupAction(input: unknown) {
  return runAction(async (user) => {
    const data = settlementGroupInsertSchema.parse(input);
    for (const part of data.parts) await assertCanSettle(user.id, part);

    const rows = await transaction(async (tx) => {
      const ids = data.parts.map((p) => p.id);
      // A retry of the same submission: the first attempt committed every part
      // (or none), so hand back what's on record and log nothing.
      const already = await tx
        .select()
        .from(tables.settlements)
        .where(inArray(tables.settlements.id, ids));
      if (already.length > 0) {
        if (already.length !== ids.length || already.some((r) => r.group_id !== data.group_id)) {
          throw new AppError("That payment was already recorded differently — refresh and try again");
        }
        return already;
      }
      const inserted = await tx
        .insert(tables.settlements)
        .values(
          data.parts.map((p) => ({
            id: p.id,
            trip_id: p.trip_id,
            from_user: p.from_user,
            to_user: p.to_user,
            amount: p.amount,
            currency: data.currency,
            note: data.note ?? null,
            group_id: data.group_id,
          })),
        )
        .returning();
      for (const row of inserted) await logSettlement(tx, user, row, recordCreated);
      return inserted;
    });
    revalidateApp();
    return rows;
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
    // A multi-trip payment goes as a whole: deleting one trip's part would
    // leave the others claiming money that, on paper, was never fully paid.
    const rows = existing.group_id
      ? await db
          .select()
          .from(tables.settlements)
          .where(eq(tables.settlements.group_id, existing.group_id))
      : [existing];
    for (const tripId of new Set(rows.map((r) => r.trip_id))) {
      await requireTripAccess(user.id, tripId, WRITE_ROLES);
    }
    // The highest-stakes event in the app: deleting a payback silently shifts
    // everyone's balance and leaves nothing behind. So the entry carries the
    // full detail — amount, currency and both ends, by name AND by id — and
    // commits in the same transaction as the delete.
    await transaction(async (tx) => {
      await tx.delete(tables.settlements).where(
        inArray(
          tables.settlements.id,
          rows.map((r) => r.id),
        ),
      );
      for (const row of rows) await logSettlement(tx, user, row, recordDeleted);
    });
    revalidateApp();
    return { id, ids: rows.map((r) => r.id) };
  });
}
