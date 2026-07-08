# AI Screenshot Parsing — Implementation Plan

## Overview

Add a screenshot upload tab to the existing BookingModal that sends an image to a Supabase Edge Function → Poe API (Claude-Sonnet-4.6 vision) → returns structured JSON → pre-fills BookingForm for user review → saves via existing `createBooking()`.

**Scope (v1):** Screenshots only (PNG, JPG, JPEG, WebP). No PDF support yet.

## What You Need

1. **Poe API Key** — [poe.com/api/keys](https://poe.com/api/keys). Costs deducted from Poe points balance.
2. **Supabase CLI** — `npm i -g supabase` (for Edge Function dev/deploy). Requires Docker Desktop for local dev.
3. That's it. No storage buckets, no extra services.

## Architecture

```
Browser                          Supabase Edge Function            Poe API
  |                                     |                            |
  | 1. User drops screenshot            |                            |
  | 2. FileReader → base64              |                            |
  | 3. POST /functions/v1/parse-booking →|                            |
  |                                     | 4. Build vision message    |
  |                                     | 5. POST chat/completions → |
  |                                     |                            | 6. AI parses image
  |                                     | 7. Receive JSON ←          |
  |                                     | 8. Validate & return       |
  | 9. Receive parsed booking(s) ←      |                            |
  | 10. Show in BookingForm (pre-filled)|                            |
  | 11. User reviews/edits & saves      |                            |
  | 12. createBooking(source:'parsed')  |                            |
```

## Implementation Steps

### Phase 1: Supabase Edge Function (backend)

1. **Create** `supabase/functions/parse-booking/index.ts` (Deno runtime)
2. **Accept POST body:**
   ```json
   { "file": "<base64 string>", "mimeType": "image/png", "trip": "Japan 2026" }
   ```
3. **Call Poe API** — `POST https://api.poe.com/v1/chat/completions`:
   - Model: `Claude-Sonnet-4.6`
   - System message: structured prompt with exact JSON output schema
   - User message: image content block (OpenAI vision format with base64 data URL)
   - `stream: false`
4. **System prompt** defines expected output:
   ```json
   {
     "bookings": [{
       "type": "flight|train|cruise|hotel|activity",
       "title": "SFO → NRT",
       "start_date": "2026-07-01T10:30:00Z",
       "end_date": "2026-07-02T14:45:00+09:00",
       "confirmation_number": "ABC123",
       "provider": "United Airlines",
       "cost_amount": 1250.00,
       "cost_currency": "USD",
       "details": {
         "departure_airport": "SFO",
         "arrival_airport": "NRT",
         "flight_number": "UA837",
         "seat": "24A",
         "terminal": "3",
         "gate": "G12"
       }
     }]
   }
   ```
   Include all type-specific detail fields (from BookingForm's TYPE_FIELDS) so AI knows what to extract.
5. **Parse & validate** — Extract JSON from AI response, verify required fields (type, title, start_date), return `{ bookings: [...] }` (always array)
6. **Error handling** — Invalid file type, Poe API failures, unparseable response → meaningful HTTP error messages
7. **Secret** — `npx supabase secrets set POE_API_KEY=sk_...`
8. **CORS** — Allow requests from localhost:5177 and your Netlify domain

### Phase 2: Upload UI Component (parallel with Phase 1)

9. **Create `src/components/UploadBooking.jsx`** — States:
   - **Idle**: Drag-and-drop zone with "Drop a screenshot here" + file picker button
   - **Preview**: Image thumbnail + filename + "Parse with AI" button
   - **Parsing**: Spinner + "AI is reading your booking..."
   - **Error**: Error message + "Try Again" button
10. **Create `src/lib/parseBooking.js`** — Helper function:
    - Accepts File object
    - Validates type (image/png, image/jpeg, image/webp) and size (max 10MB)
    - Reads as base64 via FileReader
    - POSTs to `${VITE_SUPABASE_URL}/functions/v1/parse-booking` with `Authorization: Bearer <anon_key>`
    - Returns parsed booking array

### Phase 3: Modal Integration (depends on Phase 1 & 2)

11. **Modify `BookingModal.jsx`** — Replace "📄 Upload Document (coming soon)" with working tabs:
    - Add `mode` state: `'manual'` | `'upload'`
    - "Add Manually" and "Upload Screenshot" as clickable tabs (only shown when creating, not editing)
    - When `mode === 'upload'`: render `UploadBooking` component
    - When `mode === 'manual'`: render `BookingForm` (current behavior)
12. **Pre-fill flow** — When UploadBooking gets a parsed result:
    - Single booking: switch mode to `'manual'` with the parsed data as the `booking` prop → form pre-fills
    - Multiple bookings (e.g., round-trip): show list, user picks one to review, or "Save All"
13. **Metadata** — Pre-filled form includes `source: 'parsed'`. Passes through existing `createBooking()` unchanged.
14. **Trip context** — If a trip is selected in sidebar, pre-fill the trip field and pass to Edge Function as hint.

### Phase 4: Prompt Engineering

15. **System prompt** should:
    - Define the exact JSON schema with all type-specific detail keys
    - Instruct AI to use ISO 8601 dates with timezone (infer from departure city)
    - Return `null` for missing fields (never hallucinate)
    - Return multiple bookings for multi-leg itineraries
    - Return `{ "error": "reason" }` if image is not a booking document
16. **Edge cases**: timezone inference, multi-segment itineraries, partial data, non-English documents

## Files

### Create (new)
| File | Purpose |
|------|---------|
| `supabase/functions/parse-booking/index.ts` | Edge Function — calls Poe API |
| `src/components/UploadBooking.jsx` | Drop zone + upload status UI |
| `src/lib/parseBooking.js` | Client helper to call Edge Function |

### Modify
| File | Change |
|------|--------|
| `src/components/BookingModal.jsx` | Add manual/upload tab toggle, render UploadBooking |

### No Changes Needed (already ready)
| File | Why |
|------|-----|
| `src/lib/bookings.js` | `createBooking()` already accepts `source: 'parsed'`, `raw_text` |
| `src/components/BookingForm.jsx` | Already pre-fills from `booking` prop |
| `supabase/schema.sql` | Already has `source CHECK ('manual','parsed')` column |
| `src/hooks/useBookings.js` | `add()` works with any booking shape |
| `package.json` | No new dependencies needed (screenshots only, no pdfjs-dist) |

## Verification

1. Upload flight confirmation screenshot → AI extracts airline, airports, flight #, dates, confirmation # → form pre-fills correctly
2. Upload hotel booking screenshot → check-in/out dates, hotel name, room type parsed
3. Upload multi-leg itinerary screenshot → multiple bookings returned, each saveable
4. Edit a pre-filled field before saving → confirm edited value persists
5. Verify saved booking has `source: 'parsed'` in DB
6. Upload non-booking image → graceful error message with retry
7. Verify 10MB size limit enforced client-side
8. Local test: `npx supabase functions serve` → upload from localhost:5177

## Decisions

- **Screenshots only (v1)** — No PDF, no `pdfjs-dist` dependency. Add later.
- **Process and discard** — No file storage, images only in memory during parsing
- **Poe API (OpenAI-compatible)** — Simple `fetch()` from Deno, no SDK needed, supports vision
- **User reviews before save** — Pre-fills BookingForm, user confirms/edits
- **Supabase Edge Function** — Keeps API key server-side, same project
- **Model: Claude-Sonnet-4.6** — Best at structured extraction via Poe

## Cost

- ~1,000–2,000 Poe points per parse (1 image ≈ 1,500 input tokens + ~300 output tokens)
- Monitor via `GET https://api.poe.com/v1/balance`

## Future Enhancements (v2+)

- PDF upload support (add `pdfjs-dist` for client-side PDF→image rendering)
- Multi-page PDF handling (cap at 5 pages)
- Batch upload (drag multiple screenshots at once)
- "Parse another" button after saving to quickly process a stack of bookings
- Store original image reference in `source_file` field (would need Supabase Storage)
