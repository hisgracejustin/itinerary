import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, dbReady, tables } from "@/db";
import { requireTripAccess, WRITE_ROLES } from "@/lib/authz";
import { ATTACHMENT_MAX_SIZE, isAllowedAttachmentType } from "@/lib/attachments";

export const runtime = "nodejs";

function json(body: unknown, status: number) {
  return Response.json(body, { status });
}

/**
 * Upload a file attachment for a booking. Uses multipart/form-data (fields:
 * `file`, `booking_id`) via a route handler because Server Actions cap bodies
 * at ~1MB and don't accept multipart. File bytes are stored as bytea on the
 * booking_attachments row (see the storage decision in project memory).
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return json({ error: "Unauthorized" }, 401);
  await dbReady();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "Expected multipart/form-data" }, 400);
  }

  const bookingId = form.get("booking_id");
  const file = form.get("file");

  if (typeof bookingId !== "string" || !bookingId) {
    return json({ error: "Missing booking_id" }, 400);
  }
  if (!(file instanceof File)) {
    return json({ error: "Missing file" }, 400);
  }
  if (!isAllowedAttachmentType(file.type)) {
    return json({ error: `Unsupported file type: ${file.type || "unknown"}` }, 400);
  }
  if (file.size > ATTACHMENT_MAX_SIZE) {
    return json({ error: "File too large. Maximum size is 10MB." }, 400);
  }
  if (file.size === 0) {
    return json({ error: "File is empty." }, 400);
  }

  const [booking] = await db
    .select({ trip_id: tables.bookings.trip_id })
    .from(tables.bookings)
    .where(eq(tables.bookings.id, bookingId))
    .limit(1);
  if (!booking) return json({ error: "Booking not found" }, 404);

  try {
    await requireTripAccess(session.user.id, booking.trip_id, WRITE_ROLES);
  } catch {
    return json({ error: "Forbidden" }, 403);
  }

  const content = Buffer.from(await file.arrayBuffer());

  const [row] = await db
    .insert(tables.bookingAttachments)
    .values({
      booking_id: bookingId,
      filename: file.name || "attachment",
      mime_type: file.type,
      size_bytes: file.size,
      content,
      uploaded_by: session.user.id,
    })
    .returning();

  // Return metadata only — never ship the file bytes back in the JSON response.
  return json(
    {
      id: row.id,
      booking_id: row.booking_id,
      filename: row.filename,
      mime_type: row.mime_type,
      size_bytes: row.size_bytes,
      created_at: row.created_at,
    },
    201,
  );
}
