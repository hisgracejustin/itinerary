import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, dbReady, tables } from "@/db";
import { requireTripAccess, WRITE_ROLES } from "@/lib/authz";
import {
  ATTACHMENT_MAX_LABEL,
  ATTACHMENT_MAX_SIZE,
  isAllowedAttachmentType,
} from "@/lib/attachments";

export const runtime = "nodejs";

function json(body: unknown, status: number) {
  return Response.json(body, { status });
}

/**
 * Upload a file attachment for a booking OR an expense. Uses multipart/form-data
 * (fields: `file`, plus exactly one of `booking_id` / `expense_id`) via a route
 * handler because Server Actions cap bodies at ~1MB and don't accept multipart.
 * File bytes are stored as bytea on the matching *_attachments row (see the
 * storage decision in project memory).
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return json({ error: "Unauthorized" }, 401);
  await dbReady();

  // Reject an oversized body before buffering the multipart form; ~1MB of
  // headroom covers multipart framing overhead.
  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > ATTACHMENT_MAX_SIZE + 1024 * 1024) {
    return json({ error: `File too large. Maximum size is ${ATTACHMENT_MAX_LABEL}.` }, 413);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "Expected multipart/form-data" }, 400);
  }

  const bookingId = form.get("booking_id");
  const expenseId = form.get("expense_id");
  const file = form.get("file");

  const hasBooking = typeof bookingId === "string" && bookingId.length > 0;
  const hasExpense = typeof expenseId === "string" && expenseId.length > 0;
  if (hasBooking === hasExpense) {
    return json({ error: "Provide exactly one of booking_id or expense_id" }, 400);
  }
  if (!(file instanceof File)) {
    return json({ error: "Missing file" }, 400);
  }
  if (!isAllowedAttachmentType(file.type)) {
    return json({ error: `Unsupported file type: ${file.type || "unknown"}` }, 400);
  }
  if (file.size > ATTACHMENT_MAX_SIZE) {
    return json({ error: `File too large. Maximum size is ${ATTACHMENT_MAX_LABEL}.` }, 413);
  }
  if (file.size === 0) {
    return json({ error: "File is empty." }, 400);
  }

  const [parent] = hasBooking
    ? await db
        .select({ trip_id: tables.bookings.trip_id })
        .from(tables.bookings)
        .where(eq(tables.bookings.id, bookingId as string))
        .limit(1)
    : await db
        .select({ trip_id: tables.expenses.trip_id })
        .from(tables.expenses)
        .where(eq(tables.expenses.id, expenseId as string))
        .limit(1);
  if (!parent) return json({ error: hasBooking ? "Booking not found" : "Expense not found" }, 404);

  try {
    await requireTripAccess(session.user.id, parent.trip_id, WRITE_ROLES);
  } catch {
    return json({ error: "Forbidden" }, 403);
  }

  const content = Buffer.from(await file.arrayBuffer());
  const values = {
    filename: file.name || "attachment",
    mime_type: file.type,
    size_bytes: file.size,
    content,
    uploaded_by: session.user.id,
  };

  const [row] = hasBooking
    ? await db
        .insert(tables.bookingAttachments)
        .values({ ...values, booking_id: bookingId as string })
        .returning()
    : await db
        .insert(tables.expenseAttachments)
        .values({ ...values, expense_id: expenseId as string })
        .returning();

  // Return metadata only — never ship the file bytes back in the JSON response.
  return json(
    {
      id: row.id,
      booking_id: hasBooking ? bookingId : undefined,
      expense_id: hasExpense ? expenseId : undefined,
      filename: row.filename,
      mime_type: row.mime_type,
      size_bytes: row.size_bytes,
      created_at: row.created_at,
    },
    201,
  );
}
