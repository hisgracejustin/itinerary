# AI booking parsing

Upload a booking **screenshot or PDF**; an LLM extracts structured bookings that
pre-fill the form for review before saving. Runs entirely server-side behind auth.

## Flow

```
Client (browser)                         /api/parse-booking (Next route, nodejs)      Poe API
  |                                              |                                       |
  | image → base64  |  PDF → pdf.js text         |                                       |
  | POST /api/parse-booking {file,mimeType|text,trip}                                    |
  |--------------------------------------------->| auth() gate (401 if not signed in)    |
  |                                              | build vision/text message             |
  |                                              | POST /v1/chat/completions ----------->| claude-haiku-4.5
  |                                              | validate JSON  <----------------------|
  | { bookings: [...] } <------------------------|                                       |
  | pre-fill BookingForm, user reviews & saves   |                                       |
```

- **PDF**: text is extracted **client-side** with pdf.js (the Poe vision endpoint
  doesn't take PDFs), then sent as `text`.
- **Image** (PNG/JPG/WebP): sent as base64 `file` + `mimeType` for the vision model.
- Max 10 MB; the route is `runtime = "nodejs"` and rejected with `401` when
  unauthenticated (this replaces the old Supabase RLS/JWT check).

## Files

| File | Purpose |
|---|---|
| [`src/app/api/parse-booking/route.ts`](../src/app/api/parse-booking/route.ts) | Route handler — auth gate, calls Poe, validates, returns `{ bookings }` |
| [`src/lib/parseBooking.ts`](../src/lib/parseBooking.ts) | Client helper — pdf.js text extraction, base64, `fetch('/api/parse-booking')` |
| [`src/components/UploadBooking.jsx`](../src/components/UploadBooking.jsx) | Drop zone + parse status UI |
| [`src/components/BookingModal.jsx`](../src/components/BookingModal.jsx) | Manual / upload tabs; parsed result pre-fills `BookingForm` |

## Config

- **`POE_API_KEY`** — server env, used only by the route. Model: `claude-haiku-4.5`
  via Poe's OpenAI-compatible endpoint (`https://api.poe.com/v1/chat/completions`),
  `temperature: 0`. Keys from [poe.com/api_key](https://poe.com/api_key).
- To use the Anthropic API directly instead of Poe, swap the `fetch` target, model
  id, and `POE_API_KEY` in the route — the rest of the flow is unchanged.

## pdf.js worker version

pdf.js refuses to run if the **API** version (from `pdfjs-dist`) differs from the
**worker** version. The worker is served from `public/pdf.worker.min.mjs`, copied
from the installed package by a **prebuild** step
([`scripts/copy-pdf-worker.mjs`](../scripts/copy-pdf-worker.mjs)) so it can never
drift. The worker URL is also version-pinned (`?v=<version>`) and served
network-first by the service worker, so a version bump busts stale caches.

## Verification

- Image upload → bookings extracted → form pre-filled with `source: "parsed"`.
- PDF upload → client extracts text → same result.
- Non-booking image → friendly `422` message; oversized file → `400`/`422`.
- `curl -X POST /api/parse-booking` without a session → `401`.
