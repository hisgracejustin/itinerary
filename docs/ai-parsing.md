# AI booking parsing

Upload a booking **screenshot or PDF**; an LLM extracts structured bookings that
pre-fill the form for review before saving. Runs entirely server-side behind auth.

## Flow

```
Client (browser)                         /api/parse-booking (Next route, nodejs)      AI provider
  |                                              |                                       |
  | image → base64  |  PDF → pdf.js text         |                                       |
  | POST /api/parse-booking {file,mimeType|text,trip}                                    |
  |--------------------------------------------->| auth() gate (401 if not signed in)    |
  |                                              | build request via getProvider()       |
  |                                              | POST (chat/completions | messages) -->| model
  |                                              | validate JSON  <----------------------|
  | { bookings: [...] } <------------------------|                                       |
  | pre-fill BookingForm, user reviews & saves   |                                       |
```

- **PDF**: text is extracted **client-side** with pdf.js (the Poe vision endpoint
  doesn't take PDFs), then sent as `text`.
- **Image** (PNG/JPG/WebP): sent as base64 `file` + `mimeType` for the vision model.
- Max 3 MB for images (base64 inflates by ~33% and Vercel caps bodies at 4.5 MB)
  and 10 MB for PDFs, of which only the extracted text — capped at 200k chars —
  is ever uploaded. The route is `runtime = "nodejs"` with `maxDuration = 60`,
  rejects unauthenticated callers with `401` (this replaces the old Supabase
  RLS/JWT check), and rate-limits each user to 20 parses per hour per instance.
- The model vendor is pluggable (see **Config**); by default it is Poe's
  OpenAI-compatible endpoint running `claude-haiku-4.5`.

## Files

| File | Purpose |
|---|---|
| [`src/app/api/parse-booking/route.ts`](../src/app/api/parse-booking/route.ts) | Route handler — auth gate, builds the request, calls the provider, validates, returns `{ bookings }` |
| [`src/lib/ai/provider.ts`](../src/lib/ai/provider.ts) | Provider seam — `getProvider()` factory (reads `AI_*` env), the `ModelProvider` interface, cost table |
| [`src/lib/ai/openai.ts`](../src/lib/ai/openai.ts) | OpenAI chat-completions adapter — also serves Poe, OpenRouter, Groq, Azure, Ollama |
| [`src/lib/ai/anthropic.ts`](../src/lib/ai/anthropic.ts) | Anthropic native `/v1/messages` adapter |
| [`src/lib/parseBooking.ts`](../src/lib/parseBooking.ts) | Client helper — pdf.js text extraction, base64, `fetch('/api/parse-booking')` |
| [`src/components/UploadBooking.jsx`](../src/components/UploadBooking.jsx) | Drop zone + parse status UI |
| [`src/components/BookingModal.jsx`](../src/components/BookingModal.jsx) | Manual / upload tabs; parsed result pre-fills `BookingForm` |

## Config

The provider is pluggable via env and resolved server-side by `getProvider()`.
**Defaults are back-compatible**: with nothing but `POE_API_KEY` set, the route
behaves exactly as it always has (Poe, `claude-haiku-4.5`, `temperature: 0`).

| Env | Meaning | Default |
|---|---|---|
| `AI_PROVIDER` | `poe` \| `openai` \| `anthropic` \| `openai-compatible` | `poe` |
| `AI_API_KEY` | the key; falls back to the vendor key below | — |
| `AI_MODEL` | override the model id | per-provider |
| `AI_BASE_URL` | override the endpoint (required for `openai-compatible`) | per-provider |

Per-provider key fallback and model default:

- **`poe`** — key `AI_API_KEY` → `POE_API_KEY`; base `https://api.poe.com/v1`; model `claude-haiku-4.5`. Keys from [poe.com/api_key](https://poe.com/api_key).
- **`openai`** — key `AI_API_KEY` → `OPENAI_API_KEY`; base `https://api.openai.com/v1`; model `gpt-4o-mini` (vision-capable).
- **`anthropic`** — key `AI_API_KEY` → `ANTHROPIC_API_KEY`; endpoint `https://api.anthropic.com/v1/messages`; model `claude-haiku-4-5`.
- **`openai-compatible`** — any other OpenAI-dialect endpoint (OpenRouter, Groq, Together, local vLLM/Ollama); `AI_API_KEY`, `AI_BASE_URL` and `AI_MODEL` are all required.

Switching subscriptions is therefore an env change, not a code change. The OpenAI
and Poe adapters share one file because the request/response shape is identical;
only Anthropic's native API differs (auth header, top-level `system`, base64 image
block, `content[0].text` reply).

### Token usage & cost

Every direct-API vendor returns token counts, which the route logs per parse:

```
[parse-booking] provider=openai model=gpt-4o-mini in=2731 out=384 ~$0.0006
```

A typical **screenshot** parse is ~2.5–3k input tokens (≈1.2–1.5k system prompt +
~1–1.7k for the image) plus ~200–900 output. The **PDF text** path is the
expensive one — its input scales with the extracted text (capped at 200k chars).
The `$` figure comes from a small list-price table in `provider.ts`; Poe bills in
compute points rather than tokens, so its line logs usage without a dollar
figure. Use these numbers to compare subscriptions — they're measured, not guessed.

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
