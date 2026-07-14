# Itinerary

A private travel-itinerary app — bookings on a calendar (month/week/day), grouped
by trip, with cost breakdowns, to-dos, and AI parsing of booking documents.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS v4** (design tokens + Material-style utilities in `globals.css`)
- **NextAuth v5** (Auth.js) — Google OAuth, gated by an email allowlist, JWT sessions
- **Drizzle ORM** over **Postgres** (node-postgres in prod; embedded PGlite in dev)
- **PWA** (installable, offline-tolerant service worker)
- Deployed on **Vercel**, with **Neon** (serverless Postgres) as the database and
  **Cloudflare** DNS pointing `itinerary.pondlab.app` at the Vercel deployment

## Features

- Calendar with month / week / day views, color-coded by booking type
- Bookings: flights, trains, buses, cruises, hotels, activities (type-specific fields)
- Per-trip filtering; trip date-range highlighting
- Costs page — totals + by-currency and by-type breakdowns (HKD-normalized)
- To-dos (per-trip or tripless)
- **AI parse** — upload a booking screenshot/PDF, an LLM extracts structured
  bookings that pre-fill the form for review (see [docs/ai-parsing.md](docs/ai-parsing.md))

## Local development

```bash
npm install
cp .env.example .env.local   # fill in AUTH_SECRET at minimum
npm run dev                  # http://localhost:3000
```

- With **no `DATABASE_URL`**, the app uses an embedded **PGlite** database under
  `.data/pglite` and auto-applies migrations — zero setup.
- With **no `AUTH_GOOGLE_ID`**, the login page shows a **dev sign-in** (any
  allowlisted email, no Google needed).
- `npm run build` / `npm run start` — production build; `npm run typecheck`,
  `npm run lint`.

## Environment variables

| Var | Required | Purpose |
|---|---|---|
| `AUTH_SECRET` | yes | Signs the JWT session cookie (`openssl rand -base64 32`) |
| `ALLOWED_EMAILS` | prod | Comma-separated sign-in allowlist (fails closed in prod if unset) |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | prod | Google OAuth client |
| `AUTH_URL` | prod | Public `https://itinerary.pondlab.app` (correct OAuth callbacks on the custom domain) |
| `DATABASE_URL` | prod | Neon Postgres connection string (use the pooled `-pooler` host); unset → PGlite dev DB |
| `POE_API_KEY` | for AI parse | Key for the `/api/parse-booking` route (Poe API) |
| `NEXT_PUBLIC_APP_VERSION` | no | Version shown in the sidebar (build-time inlined) |

All except `NEXT_PUBLIC_*` are runtime-only.

## Database & migrations

Schema lives in [`src/db/schema.ts`](src/db/schema.ts); generated SQL migrations in
`drizzle/`.

- `npm run db:generate` — generate a migration after changing the schema
- `npm run db:migrate` — apply migrations (drizzle-kit)
- At runtime, `dbReady()` ([`src/db/index.ts`](src/db/index.ts)) applies pending
  migrations once per process on first DB touch — so a fresh container
  self-migrates on boot; no separate migrate step is needed.

## Deployment (Vercel + Neon)

1. Create a **Neon** project; copy its **pooled** connection string
   (the `...-pooler.<region>.aws.neon.tech` host, `?sslmode=require`).
2. Import this repo into **Vercel** (framework preset: Next.js — Vercel builds it
   directly).
3. Set env vars (table above), with `DATABASE_URL` = the Neon pooled URL and
   `AUTH_URL` = `https://itinerary.pondlab.app`.
4. Point DNS at Vercel: in **Cloudflare**, add the `itinerary.pondlab.app` record
   Vercel asks for (CNAME → `cname.vercel-dns.com`, DNS-only / grey-cloud), and add
   the domain in the Vercel project.
5. Register the Google redirect URI:
   `https://itinerary.pondlab.app/api/auth/callback/google`.
6. Deploy. Migrations run automatically on first request (`dbReady`).

## Docs

- [Architecture](docs/architecture.md) — auth, data layer, project structure
- [AI parsing](docs/ai-parsing.md) — the `/api/parse-booking` flow
- [PWA & iOS safe areas](docs/pwa.md)
