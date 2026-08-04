"use server";

import { z } from "zod";
import { runAction } from "@/lib/action-utils";
import { getAuditForEntity, getAuditForTrip } from "@/lib/queries";

/**
 * Reads, unusually for this directory — the history feeds are fetched on demand
 * rather than with the page. Both surfaces are collapsed by default and most
 * visits never open them, so paying for the query (and shipping up to 100 rows
 * per trip) on every settings/booking render would be waste.
 *
 * Authorization lives in the queries themselves (admin, or an owner of the row's
 * own trip); a reader who fails it gets an empty feed, not an error.
 */

const entityTypeSchema = z.enum(["booking", "expense", "settlement", "party"]);

export async function getEntityAuditAction(entityType: unknown, entityId: unknown) {
  return runAction(async (user) =>
    getAuditForEntity(user.id, entityTypeSchema.parse(entityType), z.string().min(1).parse(entityId)),
  );
}

export async function getTripAuditAction(tripId: unknown) {
  return runAction(async (user) => getAuditForTrip(user.id, z.string().uuid().parse(tripId)));
}
