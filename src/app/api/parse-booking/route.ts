import { auth } from "@/auth";
import { naiveStamp } from "@/lib/airports";
import { sanitizeCancellationPolicy } from "@/lib/cancellation";
import {
  estimateCostUsd,
  getProvider,
  ProviderConfigError,
  ProviderEmptyError,
  ProviderHttpError,
  type ModelProvider,
  type ParseRequest,
  type ParseResult,
} from "@/lib/ai/provider";
// Whatever this runtime's ICU actually knows is the only honest definition of "a
// zone we can use" — the value ends up in Intl.DateTimeFormat. Shared with the
// schema and the form so all three accept exactly the same set.
import { SUPPORTED_ZONES } from "@/lib/timezones";

export const runtime = "nodejs";
// A vision call on a large screenshot regularly outruns the 15s default.
export const maxDuration = 60;

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
// Vercel caps request bodies at 4.5MB; base64 inflates the source file by ~33%,
// so this ceiling on the encoded string means a ~3MB original.
const MAX_SIZE_BYTES = 4 * 1024 * 1024;
// Extracted PDF text. Beyond this the model's context (and the bill) is wasted
// on a document that isn't a booking confirmation. Mirrored client-side.
const MAX_TEXT_LENGTH = 200_000;
// Headroom over MAX_SIZE_BYTES for the JSON envelope; rejects an oversized body
// from its Content-Length before we buffer it.
const MAX_BODY_BYTES = 15 * 1024 * 1024;

// Per-user parse budget. In-memory ⇒ per-warm-instance, so this is a deterrent
// (it bounds the burn rate of the paid Poe key), not a hard quota.
const parseLog = new Map<string, number[]>();
const PARSE_LIMIT = 20;
const PARSE_WINDOW_MS = 60 * 60 * 1000;

function overParseLimit(userId: string): boolean {
  const now = Date.now();
  const recent = (parseLog.get(userId) ?? []).filter((t) => now - t < PARSE_WINDOW_MS);
  if (recent.length >= PARSE_LIMIT) {
    parseLog.set(userId, recent);
    return true;
  }
  recent.push(now);
  parseLog.set(userId, recent);
  return false;
}

const SYSTEM_PROMPT = `You are a booking document parser. Extract structured booking data from the provided booking confirmation (image or PDF).

Return ONLY valid JSON with this exact structure:
{
  "bookings": [
    {
      "type": "flight" | "train" | "bus" | "rental" | "cruise" | "hotel" | "activity",
      "title": "Short descriptive title, e.g. 'SFO → NRT' or 'Hilton Tokyo'",
      "start_date": "ISO 8601 datetime WITHOUT timezone, e.g. 2026-07-01T10:30:00",
      "end_date": "ISO 8601 datetime WITHOUT timezone, or null if not available",
      "confirmation_number": "Booking reference/confirmation code or null",
      "provider": "Airline, hotel chain, train operator, etc. or null",
      "cost_amount": 1250.00,
      "cost_currency": "USD",
      "timezone": "IANA timezone identifier for where this booking happens, or null",
      "details": { ... type-specific fields ... }
    }
  ]
}

Type-specific detail fields to extract:
- Flight: departure_airport, arrival_airport, flight_number, seat, terminal, gate
- Train: departure_station, arrival_station, train_number, car, seat, maps_url
- Bus: departure_station, arrival_station, bus_number, seat, maps_url
- Rental (rental car/motorcycle/RV — agencies like Hertz/Avis or platforms like Turo, Riders Share, Getaround): vehicle_type (one of: Car, Motorcycle, RV / Camper, Scooter, Bicycle, Other), pickup_location, dropoff_location (only if different from pickup), insurance, maps_url. Title = the vehicle (e.g. "2025 Royal Enfield Himalayan 450"), provider = the rental company or platform, start_date = pick-up time, end_date = drop-off/return time.
- Cruise: ship_name, cabin, deck, departure_port, arrival_port, ports_of_call (array of intermediate port names, in order), maps_url
- Hotel: address, check_in_time, check_out_time, room_type, maps_url, laundry (boolean true ONLY when the document says the property has a washer or laundry facilities — omit the field otherwise, never guess false)
- Activity: location, address, duration, maps_url

All types may also include:
- notes: free-text info worth keeping that fits no other field (host contact, luggage allowance, meal, special instructions). Omit if none.
- cancellation_policy: array of refund tiers, ONLY if the document states a cancellation policy, e.g.
  [{ "cutoff": "2026-09-05", "kind": "fee", "value": 25 }, { "cutoff": "2026-09-20", "kind": "amount", "value": 500 }]
  Each tier means: cancelling on or before "cutoff" refunds "value", read according to "kind" — a percent of the booking cost ("percent"), a flat amount in cost_currency ("amount"), or a cancellation/service fee in cost_currency that is DEDUCTED from an otherwise full refund ("fee", e.g. "free cancellation minus a $25 service fee until 5 Sep" → { "cutoff": "2026-09-05", "kind": "fee", "value": 25 }). Order tiers by cutoff ascending.
  "cutoff" is "YYYY-MM-DD", or "YYYY-MM-DDTHH:mm" when the document states a specific deadline time (e.g. "free cancellation until 6:00 PM on 5 Sep" → "2026-09-05T18:00"). Use the time exactly as printed — no timezone conversion.
  A tier may ALSO carry "credit": { "kind": "percent"|"amount", "value": N, "mode": "or"|"and", "expiry": "YYYY-MM-DD" } when what comes back is a voucher / future travel credit / e-credit rather than (or as well as) money — same reading of "kind" and "value" as above. "mode" is "or" when the credit is offered INSTEAD of the cash refund ("or", "either", "in lieu of", and every airline flight credit) and "and" only when the document says the credit comes in addition to it; when unstated use "or". "expiry" is the date the credit must be USED by — omit it entirely if the document states no expiry date.
  A fare that cannot be refunded to the original payment method but CAN be cancelled for airline flight credit is cash value 0 plus a credit, with the cutoff at the departure datetime, e.g. [{ "cutoff": "2026-09-05T14:30", "kind": "percent", "value": 0, "credit": { "kind": "percent", "value": 100, "mode": "or" } }]. Use "non_refundable" only when nothing at all comes back, credit included.
  If instead the document explicitly states the booking is non-refundable / cannot be cancelled, use the string "non_refundable" in place of the array: "cancellation_policy": "non_refundable".
  Omit the field entirely if no policy is stated. NEVER invent a policy, a credit, or an expiry date.

Layover / connecting flight handling:
- For multi-leg journeys (e.g. SFO → LAX → NRT), return EACH leg as a separate flight booking.
- The app will let the user merge legs into a single layover booking on the client side.
- Make sure each leg has its own departure_airport, arrival_airport, flight_number, start_date, and end_date.
- If the document shows a connection/layover time between legs, that info is captured by the leg end_date and next leg start_date.

Timezone:
- "timezone" is the IANA identifier for the LOCATION this booking happens in — a Paris hotel is "Europe/Paris", a Kyoto ryokan "Asia/Tokyo", a Lisbon walking tour "Europe/Lisbon". For a flight, use the DEPARTURE airport's zone; for a train or bus, the departure station's.
- It is metadata ABOUT the times you transcribe, describing which clock they were printed on. It does NOT license converting them: every time you emit still comes out exactly as printed (see the rule below).
- If the document gives no location you can place — no city, no address, no airport or station — return null. Do NOT pick a plausible-sounding zone.

Rules:
- Use null for any field you cannot find in the document. NEVER hallucinate data.
- IMPORTANT: Do NOT apply any timezone conversions. Use times EXACTLY as they appear in the document. If it says "7:30 AM" then use "07:30:00". If it says "3:30 PM" use "15:30:00". Never convert between timezones.
- For round-trip flights, return each direction as a separate booking.
- maps_url is an OVERRIDE, not something to manufacture: return it only when the document itself contains a map or location link. Do NOT build a Google Maps search URL out of an address — the app derives that from the meeting point at render time, and a generated URL saved onto the booking would go stale the moment the address is edited. Omit the field when the document has no such link, and never emit one for a flight.
- If the document is NOT a booking/travel document, return: { "error": "This doesn't appear to be a booking confirmation. Please upload a screenshot of a flight, hotel, train, bus, cruise, rental, or activity booking." }
- Return ONLY the JSON object, no markdown fencing, no explanation.`;

/**
 * Coerce a model-emitted amount to a clean number or null. Handles the strings
 * the model produces when it ignores the "number" instruction: "$1,234.50",
 * "USD 1 234,50" (European decimal comma), "1234". Anything ambiguous → null,
 * which the UI shows as a blank field — wrong-but-blank beats silently wrong.
 */
function normalizeAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  // Strip everything except digits, separators and sign.
  let s = value.replace(/[^\d.,\-]/g, "");
  if (!s) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    // Both present: the rightmost one is the decimal separator.
    s = lastComma > lastDot
      ? s.replace(/\./g, "").replace(",", ".")
      : s.replace(/,/g, "");
  } else if (lastComma > -1) {
    // Comma only: decimal if followed by 1-2 digits ("1234,50"), else thousands.
    const frac = s.length - lastComma - 1;
    s = frac > 0 && frac <= 2 && s.indexOf(",") === lastComma
      ? s.replace(",", ".")
      : s.replace(/,/g, "");
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Coerce a model-emitted timezone to a usable IANA id or null.
 *
 * Strict membership, no repair: an invented or abbreviated zone ("Mars/Olympus",
 * "EST") that survived would be read as fact by every cancellation-cutoff
 * comparison on that booking, silently shifting deadlines by hours. Null is not
 * a loss — it means "no answer", and the derivation chain in
 * src/lib/booking-zones.js answers instead.
 */
function normalizeTimezone(value: unknown): string | null {
  return typeof value === "string" && SUPPORTED_ZONES.has(value) ? value : null;
}

function json(body: unknown, status: number) {
  return Response.json(body, { status });
}

export async function POST(req: Request) {
  // Auth/allowlist replacement for the old RLS-guarded edge function.
  const session = await auth();
  if (!session?.user) return json({ error: "Unauthorized" }, 401);

  if (overParseLimit(session.user.id)) {
    return json({ error: "Parse limit reached — try again in a while." }, 429);
  }

  if (Number(req.headers.get("content-length") || 0) > MAX_BODY_BYTES) {
    return json({ error: "That upload is too large to parse. Maximum size is 3MB." }, 413);
  }

  try {
    const { file, mimeType, trip, text } = await req.json();

    if (file != null && typeof file !== "string") {
      return json({ error: "'file' must be a base64 string" }, 400);
    }
    if (text != null && typeof text !== "string") {
      return json({ error: "'text' must be a string" }, 400);
    }

    const isTextMode = !!text && text.length > 0;
    const isImageMode = !!file && !!mimeType;

    if (!isTextMode && !isImageMode) {
      return json({ error: "Missing required fields: provide either 'text' or 'file' + 'mimeType'" }, 400);
    }

    if (isTextMode && text.length > MAX_TEXT_LENGTH) {
      return json(
        { error: "That document's text is too long to parse — try a screenshot of the booking section instead." },
        413,
      );
    }

    if (isImageMode) {
      if (!ALLOWED_TYPES.includes(mimeType)) {
        return json({ error: `Unsupported file type: ${mimeType}. Accepted: PNG, JPG, WebP, PDF` }, 400);
      }
      if (file.length > MAX_SIZE_BYTES) {
        return json({ error: "File too large. Maximum size is 3MB." }, 413);
      }
    }

    // Which vendor answers is an env decision (AI_PROVIDER); the request we
    // build and everything we do with the reply is the same for all of them.
    let provider: ModelProvider;
    try {
      provider = getProvider();
    } catch (err) {
      if (err instanceof ProviderConfigError) {
        console.error("AI provider misconfigured:", err.message);
        return json({ error: "Server misconfiguration: missing API key" }, 500);
      }
      throw err;
    }

    // The trip context and the "text"/"document" wording are folded into one
    // instruction string so each adapter only has to place it (alongside the
    // image, or ahead of the extracted text). This reproduces the exact prompt
    // the route sent before providers were pluggable.
    const tripSuffix = trip ? ` The trip context is: "${trip}".` : "";
    const parseReq: ParseRequest = isTextMode
      ? { system: SYSTEM_PROMPT, instruction: `Parse this booking document text.${tripSuffix}`, text }
      : {
          system: SYSTEM_PROMPT,
          instruction: `Parse this booking document.${tripSuffix}`,
          image: { mimeType, base64: file },
        };

    let result: ParseResult;
    try {
      // Abort short of maxDuration so a hung upstream returns a real message
      // instead of the platform's opaque function timeout.
      result = await provider.parse(parseReq, AbortSignal.timeout(45_000));
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        return json({ error: "The parsing service took too long — try again." }, 504);
      }
      if (err instanceof ProviderHttpError) {
        console.error("AI provider error:", err.status, err.body);
        return json({ error: `AI service error (${err.status}). Please try again.` }, 502);
      }
      if (err instanceof ProviderEmptyError) {
        return json({ error: "No response from AI. Please try again." }, 502);
      }
      throw err;
    }

    // What this parse actually cost, when the vendor reports token usage — the
    // measured answer to "how much per parse" rather than a guess.
    if (result.usage) {
      const cost = estimateCostUsd(provider.model, result.usage);
      console.log(
        `[parse-booking] provider=${provider.id} model=${provider.model} ` +
          `in=${result.usage.inputTokens} out=${result.usage.outputTokens}` +
          (cost != null ? ` ~$${cost.toFixed(4)}` : ""),
      );
    }

    const content = result.content;

    let parsed: Record<string, unknown>;
    try {
      const cleaned = content
        .replace(/^```(?:json)?\s*\n?/m, "")
        .replace(/\n?```\s*$/m, "")
        .trim();
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse AI response:", content);
      return json(
        { error: "AI returned an invalid response. Please try again with a clearer screenshot." },
        422,
      );
    }

    if (parsed.error) {
      return json({ error: parsed.error as string }, 422);
    }

    if (!parsed.bookings || !Array.isArray(parsed.bookings) || parsed.bookings.length === 0) {
      return json(
        { error: "Could not extract any bookings from this image. Please try a clearer screenshot." },
        422,
      );
    }

    const validTypes = ["flight", "train", "bus", "rental", "cruise", "hotel", "activity"];
    for (const b of parsed.bookings as Record<string, unknown>[]) {
      if (!b.type || !validTypes.includes(b.type as string)) {
        b.type = "activity"; // fallback
      }
      if (!b.title) {
        return json({ error: "AI could not determine a title for the booking." }, 422);
      }
      if (!b.start_date) {
        return json({ error: "AI could not determine the date for the booking." }, 422);
      }
      // The model is told to return cost_amount as a number, but sometimes emits
      // "$1,234.50" anyway — and parseFloat("1,234.50") is 1, which downstream
      // would total into silently wrong money. Normalize here so every consumer
      // (merge, form, per-leg save) sees a clean number or null.
      b.cost_amount = normalizeAmount(b.cost_amount);
      b.timezone = normalizeTimezone(b.timezone);
      // Same details sanitation the Zod layer applies on save — a hallucinated
      // tier shape or a stringified port list would otherwise reach the form and
      // (for the policy) render as [object Object].
      if (b.details && typeof b.details === "object") {
        const d = b.details as Record<string, unknown>;
        const policy = sanitizeCancellationPolicy(d.cancellation_policy);
        if (policy) d.cancellation_policy = policy;
        else delete d.cancellation_policy;
        if (d.ports_of_call !== undefined && (!Array.isArray(d.ports_of_call) || d.ports_of_call.length === 0)) delete d.ports_of_call;
        if (d.notes !== undefined && typeof d.notes !== "string") delete d.notes;
        if (d.laundry !== undefined && typeof d.laundry !== "boolean") delete d.laundry;
        // Layover timestamps are the only parsed dates that reach the DB
        // verbatim — start/end go through the form's wall-clock laundering,
        // these are assembled straight into details at merge time. Storage is
        // naive wall clock, so a hallucinated 'Z' would survive and then move
        // with the reader; drop what can't be read as a wall-clock time rather
        // than keep a stamp we'd have to guess the meaning of.
        if (Array.isArray(d.layovers)) {
          for (const lo of d.layovers) {
            if (!lo || typeof lo !== "object") continue;
            for (const key of ["arrival", "departure"]) {
              const stamp = naiveStamp(lo[key]);
              if (stamp) lo[key] = stamp;
              else delete lo[key];
            }
          }
        }
      }
    }

    return json(parsed, 200);
  } catch (err) {
    console.error("Unexpected error:", err);
    return json({ error: "Internal server error" }, 500);
  }
}
