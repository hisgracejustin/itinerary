import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, dbReady, tables } from "@/db";
import { requireTripAccess, WRITE_ROLES } from "@/lib/authz";

export const runtime = "nodejs";

function json(body: unknown, status: number) {
  return Response.json(body, { status });
}

/** RFC 5987 Content-Disposition supporting non-ASCII filenames. */
function contentDisposition(filename: string, download: boolean): string {
  const type = download ? "attachment" : "inline";
  const asciiFallback = filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "'");
  return `${type}; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * Look up an attachment joined to its parent's trip for authz. Booking and
 * expense attachments live in separate tables but share this route; ids are
 * cuid2 from one generator, so an id belongs to at most one of them.
 */
async function loadAttachment(id: string) {
  const [booking] = await db
    .select({
      id: tables.bookingAttachments.id,
      filename: tables.bookingAttachments.filename,
      mime_type: tables.bookingAttachments.mime_type,
      size_bytes: tables.bookingAttachments.size_bytes,
      content: tables.bookingAttachments.content,
      trip_id: tables.bookings.trip_id,
    })
    .from(tables.bookingAttachments)
    .innerJoin(tables.bookings, eq(tables.bookingAttachments.booking_id, tables.bookings.id))
    .where(eq(tables.bookingAttachments.id, id))
    .limit(1);
  if (booking) return { ...booking, kind: "booking" as const };

  const [expense] = await db
    .select({
      id: tables.expenseAttachments.id,
      filename: tables.expenseAttachments.filename,
      mime_type: tables.expenseAttachments.mime_type,
      size_bytes: tables.expenseAttachments.size_bytes,
      content: tables.expenseAttachments.content,
      trip_id: tables.expenses.trip_id,
    })
    .from(tables.expenseAttachments)
    .innerJoin(tables.expenses, eq(tables.expenseAttachments.expense_id, tables.expenses.id))
    .where(eq(tables.expenseAttachments.id, id))
    .limit(1);
  return expense ? { ...expense, kind: "expense" as const } : undefined;
}

// View (inline) or download (?download=1) an attachment.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return json({ error: "Unauthorized" }, 401);
  await dbReady();

  const { id } = await params;
  const row = await loadAttachment(id);
  if (!row) return json({ error: "Not found" }, 404);

  try {
    await requireTripAccess(session.user.id, row.trip_id);
  } catch {
    return json({ error: "Forbidden" }, 403);
  }

  const download = new URL(req.url).searchParams.get("download") === "1";
  // node-postgres returns Buffer, PGlite returns Uint8Array — both are valid
  // BodyInit, so pass the bytes straight through rather than copying the whole
  // file a second time into the function's heap.
  return new Response(row.content as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": row.mime_type || "application/octet-stream",
      "Content-Length": String(row.size_bytes),
      "Content-Disposition": contentDisposition(row.filename, download),
      "Cache-Control": "private, no-store",
      // This route echoes a mime type the uploader supplied, and the "View"
      // link opens it as a top-level document on our own origin. The upload
      // allowlist (src/lib/attachments.ts) excludes html/svg today, so these
      // two are for the day it widens: nosniff stops a mislabelled file being
      // re-typed as markup, and the sandbox strips scripts and drops the
      // document to an opaque origin so it can never touch the session.
      // `allow-downloads` is required or the ?download=1 link silently fails.
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox allow-downloads",
    },
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return json({ error: "Unauthorized" }, 401);
  await dbReady();

  const { id } = await params;
  const row = await loadAttachment(id);
  if (!row) return json({ error: "Not found" }, 404);

  try {
    await requireTripAccess(session.user.id, row.trip_id, WRITE_ROLES);
  } catch {
    return json({ error: "Forbidden" }, 403);
  }

  if (row.kind === "booking") {
    await db.delete(tables.bookingAttachments).where(eq(tables.bookingAttachments.id, id));
  } else {
    await db.delete(tables.expenseAttachments).where(eq(tables.expenseAttachments.id, id));
  }
  return json({ id }, 200);
}
