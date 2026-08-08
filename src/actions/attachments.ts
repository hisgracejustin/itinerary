"use server";

import { asc, eq } from "drizzle-orm";
import { db, tables } from "@/db";
import { runAction } from "@/lib/action-utils";
import { requireTripAccess } from "@/lib/authz";
import { AppError } from "@/lib/errors";

/**
 * Attachment metadata for a booking (never returns `content` — the bytes are
 * streamed by the GET /api/attachments/[id] route). Read access is gated on
 * membership of the booking's trip, mirroring getBookingAction.
 */
export async function getBookingAttachmentsAction(bookingId: string) {
  return runAction(async (user) => {
    const [booking] = await db
      .select({ trip_id: tables.bookings.trip_id })
      .from(tables.bookings)
      .where(eq(tables.bookings.id, bookingId))
      .limit(1);
    if (!booking) throw new AppError("Booking not found");
    await requireTripAccess(user.id, booking.trip_id);
    return db
      .select({
        id: tables.bookingAttachments.id,
        booking_id: tables.bookingAttachments.booking_id,
        filename: tables.bookingAttachments.filename,
        mime_type: tables.bookingAttachments.mime_type,
        size_bytes: tables.bookingAttachments.size_bytes,
        created_at: tables.bookingAttachments.created_at,
      })
      .from(tables.bookingAttachments)
      .where(eq(tables.bookingAttachments.booking_id, bookingId))
      .orderBy(asc(tables.bookingAttachments.created_at));
  });
}

/** The same, for an expense's receipts. Gated on membership of its trip. */
export async function getExpenseAttachmentsAction(expenseId: string) {
  return runAction(async (user) => {
    const [expense] = await db
      .select({ trip_id: tables.expenses.trip_id })
      .from(tables.expenses)
      .where(eq(tables.expenses.id, expenseId))
      .limit(1);
    if (!expense) throw new AppError("Expense not found");
    await requireTripAccess(user.id, expense.trip_id);
    return db
      .select({
        id: tables.expenseAttachments.id,
        expense_id: tables.expenseAttachments.expense_id,
        filename: tables.expenseAttachments.filename,
        mime_type: tables.expenseAttachments.mime_type,
        size_bytes: tables.expenseAttachments.size_bytes,
        created_at: tables.expenseAttachments.created_at,
      })
      .from(tables.expenseAttachments)
      .where(eq(tables.expenseAttachments.expense_id, expenseId))
      .orderBy(asc(tables.expenseAttachments.created_at));
  });
}
