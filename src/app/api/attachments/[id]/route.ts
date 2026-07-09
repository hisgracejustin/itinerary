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

/** Look up an attachment joined to its booking's trip for authz. */
async function loadAttachment(id: string) {
  const [row] = await db
    .select({
      id: tables.bookingAttachments.id,
      filename: tables.bookingAttachments.filename,
      mime_type: tables.bookingAttachments.mime_type,
      content: tables.bookingAttachments.content,
      trip_id: tables.bookings.trip_id,
    })
    .from(tables.bookingAttachments)
    .innerJoin(tables.bookings, eq(tables.bookingAttachments.booking_id, tables.bookings.id))
    .where(eq(tables.bookingAttachments.id, id))
    .limit(1);
  return row;
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
  // node-postgres returns Buffer, PGlite returns Uint8Array — both are valid BodyInit.
  const body = row.content as unknown as Uint8Array;
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      "Content-Type": row.mime_type || "application/octet-stream",
      "Content-Disposition": contentDisposition(row.filename, download),
      "Cache-Control": "private, no-store",
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

  await db.delete(tables.bookingAttachments).where(eq(tables.bookingAttachments.id, id));
  return json({ id }, 200);
}
