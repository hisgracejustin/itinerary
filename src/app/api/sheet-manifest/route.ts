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

  // Naive date strings, lexicographic compare. The date this compares against
  // is UTC (this server's clock) while booking dates are naive local days, so it
  // carries one day of slack — more than the ~26h of real-world skew. Without
  // it, a traveller in a Vancouver evening loses today's hotel voucher from the
  // offline cache because UTC has already rolled over. One extra day of stale
  // attachments is a cheap price for that. Booking dates carry a time; slice to
  // the day.
  const keepFrom = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const rows = await getAttachmentsForUser(session.user.id);
  const attachments = rows
    .filter((a) => (a.booking_end ?? a.booking_start).slice(0, 10) >= keepFrom)
    .slice(0, MAX_ATTACHMENTS)
    .map((a) => `/api/attachments/${a.id}`);

  return Response.json(
    { userId: session.user.id, attachments },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
