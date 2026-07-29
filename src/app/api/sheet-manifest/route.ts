import { auth } from "@/auth";
import { dbReady } from "@/db";
import { getAttachmentsForUser } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Attachment bytes are the expensive part of an offline copy, so only files
// hanging off bookings that haven't happened yet get pre-cached, newest trip
// last — and never more than this many.
const MAX_ATTACHMENTS = 40;

/**
 * What the app shell needs to keep the offline day sheet current: the owning
 * user (so a shared browser can purge another account's cached sheet) and the
 * attachment URLs worth warming in the service worker's sheet cache.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  await dbReady();

  // Naive date strings, lexicographic compare — same convention as the rest of
  // the date/policy logic. Booking dates carry a time; slice to the day.
  const today = new Date().toISOString().slice(0, 10);
  const rows = await getAttachmentsForUser(session.user.id);
  const attachments = rows
    .filter((a) => (a.booking_end ?? a.booking_start).slice(0, 10) >= today)
    .slice(0, MAX_ATTACHMENTS)
    .map((a) => `/api/attachments/${a.id}`);

  return Response.json(
    { userId: session.user.id, attachments },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
