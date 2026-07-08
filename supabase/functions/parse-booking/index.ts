import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"]
const MAX_SIZE_BYTES = 10 * 1024 * 1024 // 10MB base64 ≈ ~7.5MB original

const SYSTEM_PROMPT = `You are a booking document parser. Extract structured booking data from the provided booking confirmation (image or PDF).

Return ONLY valid JSON with this exact structure:
{
  "bookings": [
    {
      "type": "flight" | "train" | "bus" | "cruise" | "hotel" | "activity",
      "title": "Short descriptive title, e.g. 'SFO → NRT' or 'Hilton Tokyo'",
      "start_date": "ISO 8601 datetime WITHOUT timezone, e.g. 2026-07-01T10:30:00",
      "end_date": "ISO 8601 datetime WITHOUT timezone, or null if not available",
      "confirmation_number": "Booking reference/confirmation code or null",
      "provider": "Airline, hotel chain, train operator, etc. or null",
      "cost_amount": 1250.00,
      "cost_currency": "USD",
      "details": { ... type-specific fields ... }
    }
  ]
}

Type-specific detail fields to extract:
- Flight: departure_airport, arrival_airport, flight_number, seat, terminal, gate
- Train: departure_station, arrival_station, train_number, car, seat
- Bus: departure_station, arrival_station, bus_number, seat
- Cruise: ship_name, cabin, deck, departure_port, arrival_port
- Hotel: address, check_in_time, check_out_time, room_type
- Activity: location, address, duration, notes, maps_url

Layover / connecting flight handling:
- For multi-leg journeys (e.g. SFO → LAX → NRT), return EACH leg as a separate flight booking.
- The app will let the user merge legs into a single layover booking on the client side.
- Make sure each leg has its own departure_airport, arrival_airport, flight_number, start_date, and end_date.
- If the document shows a connection/layover time between legs, that info is captured by the leg end_date and next leg start_date.

Rules:
- Use null for any field you cannot find in the document. NEVER hallucinate data.
- IMPORTANT: Do NOT apply any timezone conversions. Use times EXACTLY as they appear in the document. If it says "7:30 AM" then use "07:30:00". If it says "3:30 PM" use "15:30:00". Never convert between timezones.
- For round-trip flights, return each direction as a separate booking.
- For maps_url: if an address is available, generate a Google Maps search URL like "https://www.google.com/maps/search/" followed by the URL-encoded address.
- If the document is NOT a booking/travel document, return: { "error": "This doesn't appear to be a booking confirmation. Please upload a screenshot of a flight, hotel, train, bus, cruise, or activity booking." }
- Return ONLY the JSON object, no markdown fencing, no explanation.`

export default async function handler(req: Request): Promise<Response> {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    })
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  try {
    const { file, mimeType, trip, text } = await req.json()

    // Two modes: text extraction (cheaper) or image vision
    const isTextMode = !!text && text.length > 0
    const isImageMode = !!file && !!mimeType

    if (!isTextMode && !isImageMode) {
      return jsonResponse({ error: "Missing required fields: provide either 'text' or 'file' + 'mimeType'" }, 400)
    }

    if (isImageMode) {
      if (!ALLOWED_TYPES.includes(mimeType)) {
        return jsonResponse({ error: `Unsupported file type: ${mimeType}. Accepted: PNG, JPG, WebP, PDF` }, 400)
      }

      if (file.length > MAX_SIZE_BYTES) {
        return jsonResponse({ error: "File too large. Maximum size is 10MB." }, 400)
      }
    }

    // Get API key from secrets
    const apiKey = Deno.env.get("POE_API_KEY")
    if (!apiKey) {
      return jsonResponse({ error: "Server misconfiguration: missing API key" }, 500)
    }

    // Build the message content based on mode
    let userContent: unknown[]
    if (isTextMode) {
      // Text-only mode (extracted from PDF) — much cheaper, no vision needed
      userContent = [
        {
          type: "text",
          text: trip
            ? `Parse this booking document text. The trip context is: "${trip}".\n\n---\n${text}`
            : `Parse this booking document text.\n\n---\n${text}`,
        },
      ]
    } else {
      // Image mode — uses vision
      userContent = [
        {
          type: "image_url",
          image_url: {
            url: `data:${mimeType};base64,${file}`,
          },
        },
        {
          type: "text",
          text: trip
            ? `Parse this booking document. The trip context is: "${trip}".`
            : "Parse this booking document.",
        },
      ]
    }

    const poeResponse = await fetch("https://api.poe.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4.5",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        stream: false,
        temperature: 0,
      }),
    })

    if (!poeResponse.ok) {
      const errBody = await poeResponse.text()
      console.error("Poe API error:", poeResponse.status, errBody)
      return jsonResponse(
        { error: `AI service error (${poeResponse.status}). Please try again.` },
        502
      )
    }

    const poeData = await poeResponse.json()
    const content = poeData.choices?.[0]?.message?.content

    if (!content) {
      return jsonResponse({ error: "No response from AI. Please try again." }, 502)
    }

    // Parse the AI response as JSON
    let parsed: Record<string, unknown>
    try {
      // Strip markdown code fences if present
      const cleaned = content.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim()
      parsed = JSON.parse(cleaned)
    } catch {
      console.error("Failed to parse AI response:", content)
      return jsonResponse(
        { error: "AI returned an invalid response. Please try again with a clearer screenshot." },
        422
      )
    }

    // Check if AI reported an error
    if (parsed.error) {
      return jsonResponse({ error: parsed.error as string }, 422)
    }

    // Validate structure
    if (!parsed.bookings || !Array.isArray(parsed.bookings) || parsed.bookings.length === 0) {
      return jsonResponse(
        { error: "Could not extract any bookings from this image. Please try a clearer screenshot." },
        422
      )
    }

    // Validate required fields on each booking
    const validTypes = ["flight", "train", "cruise", "hotel", "activity"]
    for (const b of parsed.bookings as Record<string, unknown>[]) {
      if (!b.type || !validTypes.includes(b.type as string)) {
        b.type = "activity" // fallback
      }
      if (!b.title) {
        return jsonResponse({ error: "AI could not determine a title for the booking." }, 422)
      }
      if (!b.start_date) {
        return jsonResponse({ error: "AI could not determine the date for the booking." }, 422)
      }
    }

    return jsonResponse(parsed, 200)
  } catch (err) {
    console.error("Unexpected error:", err)
    return jsonResponse({ error: "Internal server error" }, 500)
  }
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey, x-client-info",
  }
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(),
    },
  })
}

Deno.serve(handler)
