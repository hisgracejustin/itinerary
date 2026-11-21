import { auth } from "@/auth";
import { dbReady } from "@/db";
import { requireTripAccess } from "@/lib/authz";
import { getFxRatesOn, getLatestFxRates } from "@/lib/fx";
import { getSettleData, getTripsWithMembers } from "@/lib/queries";
import { buildTripSummary } from "@/lib/trip-summary";
import { renderTripSummaryPdf } from "@/lib/trip-summary-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Rendering takes about a second; a cold start that loads the CJK font takes
// longer, so allow some headroom.
export const maxDuration = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The exporter's IANA time zone when it's a real one, else UTC. */
function zoneOrUtc(zone: string | null) {
  if (!zone || zone.length > 64) return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return zone;
  } catch {
    return "UTC";
  }
}

function json(body: unknown, status: number) {
  return Response.json(body, { status });
}

/**
 * The trip-summary PDF for one trip: settle-up, balances, where the money went
 * and every shared cost — the same numbers as Settle up. Any member of the trip
 * can export it (read-only). `?tz=` is the exporter's time zone, so "prepared",
 * payment dates and whether the trip is over are their days rather than the
 * server's UTC ones.
 */
export async function GET(req: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return json({ error: "Unauthorized" }, 401);
  await dbReady();

  const { tripId } = await params;
  if (!UUID.test(tripId)) return json({ error: "Not found" }, 404);
  try {
    await requireTripAccess(userId, tripId);
  } catch {
    return json({ error: "Not found" }, 404);
  }

  const [data, trips, fx] = await Promise.all([getSettleData(userId), getTripsWithMembers(userId), getLatestFxRates()]);
  const trip = trips.find((t) => t.id === tripId);
  if (!trip) return json({ error: "Not found" }, 404);
  const only = (row: { trip_id: string }) => row.trip_id === tripId;
  const timeZone = zoneOrUtc(new URL(req.url).searchParams.get("tz"));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  // Once the trip is over, ≈ HK$ figures use the rates at its end, so the PDF
  // says the same whenever it's made; until then, the latest rates.
  const tripEnd = String(trip.end_date ?? "").slice(0, 10);
  const atEnd = tripEnd && tripEnd < today ? await getFxRatesOn(tripEnd) : null;
  const rates = atEnd ? { ...atEnd, basis: "trip-end" as const } : { ...fx, basis: "latest" as const };

  const summary = buildTripSummary({
    trip,
    members: data.members.filter(only),
    parties: data.parties.filter(only),
    bookings: data.bookings.filter(only),
    expenses: data.expenses.filter(only),
    settlements: data.settlements.filter(only),
    rates: rates.rates,
    rateDate: rates.rateDate,
    rateBasis: rates.basis,
    preparedBy: session.user?.name || session.user?.email?.split("@")[0] || "",
    generatedOn: today,
    timeZone,
  });
  const pdf = await renderTripSummaryPdf(summary);

  const filename = `${summary.trip.name} - trip summary.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^\x20-\x7e]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
